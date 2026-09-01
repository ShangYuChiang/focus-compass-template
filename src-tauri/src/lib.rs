use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

const MAX_BACKUP_BYTES: u64 = 20 * 1024 * 1024;

/// 預設備份資料夾：文件\步步\backups
fn resolve_default_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| format!("找不到「文件」資料夾：{error}"))?;
    Ok(documents.join("步步").join("backups"))
}

#[tauri::command]
fn default_backup_folder(app: AppHandle) -> Result<String, String> {
    Ok(resolve_default_folder(&app)?.to_string_lossy().into_owned())
}

/// 把備份寫成 JSON 檔，回傳寫入的位元組數。
/// 資料夾不存在時會建立；失敗時回傳含路徑的錯誤訊息，方便使用者判斷問題。
#[tauri::command]
fn write_backup(
    app: AppHandle,
    folder: Option<String>,
    file_name: String,
    contents: String,
) -> Result<u64, String> {
    if file_name.contains(['/', '\\']) || file_name.contains("..") {
        return Err(format!("備份檔名不合法：{file_name}"));
    }

    let target_folder = match folder {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => resolve_default_folder(&app)?,
    };

    write_backup_file(&target_folder, &file_name, &contents)
}

fn write_backup_file(target_folder: &std::path::Path, file_name: &str, contents: &str) -> Result<u64, String> {
    fs::create_dir_all(target_folder)
        .map_err(|error| format!("無法建立備份資料夾 {}：{error}", target_folder.display()))?;

    let target_file = target_folder.join(file_name);
    fs::write(&target_file, contents.as_bytes())
        .map_err(|error| format!("無法寫入備份檔 {}：{error}", target_file.display()))?;

    Ok(contents.as_bytes().len() as u64)
}

/// 只讀取使用者在原生檔案選擇器中選到的 JSON，並限制大小，避免意外載入巨大檔案。
#[tauri::command]
fn read_backup(path: String) -> Result<String, String> {
    read_backup_file(std::path::Path::new(&path))
}

fn read_backup_file(path: &std::path::Path) -> Result<String, String> {
    if path.extension().and_then(|value| value.to_str()).is_none_or(|value| !value.eq_ignore_ascii_case("json")) {
        return Err("只能還原 JSON 備份檔。".to_string());
    }
    let metadata = fs::metadata(path)
        .map_err(|error| format!("無法讀取備份檔 {}：{error}", path.display()))?;
    if !metadata.is_file() {
        return Err("選取的路徑不是檔案。".to_string());
    }
    if metadata.len() > MAX_BACKUP_BYTES {
        return Err("備份檔超過 20 MB，為了安全不予載入。".to_string());
    }
    fs::read_to_string(path)
        .map_err(|error| format!("備份檔不是有效的 UTF-8 文字：{error}"))
}

/// 將使用者在原生「另存新檔」視窗選定的收工卡匯出檔寫入磁碟。
#[tauri::command]
fn write_review_export(path: String, contents: String) -> Result<u64, String> {
    write_review_export_file(std::path::Path::new(&path), &contents)
}

fn write_review_export_file(path: &std::path::Path, contents: &str) -> Result<u64, String> {
    validate_review_export_path(path)?;
    fs::write(path, contents.as_bytes())
        .map_err(|error| format!("無法寫入收工卡 {}：{error}", path.display()))?;
    Ok(contents.len() as u64)
}

fn validate_review_export_path(path: &std::path::Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if !matches!(extension.as_deref(), Some("md" | "csv" | "json")) {
        return Err("收工卡只能匯出為 Markdown、CSV 或 JSON 檔。".to_string());
    }
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewExportFile {
    file_name: String,
    contents: String,
}

/// 三種格式共用一次資料夾選擇，並在任何寫入前驗證全部檔名。
#[tauri::command]
fn write_review_export_bundle(folder: String, files: Vec<ReviewExportFile>) -> Result<u64, String> {
    write_review_export_bundle_files(std::path::Path::new(&folder), &files)
}

fn write_review_export_bundle_files(folder: &std::path::Path, files: &[ReviewExportFile]) -> Result<u64, String> {
    if !folder.is_dir() {
        return Err(format!("選取的收工卡匯出位置不是資料夾：{}", folder.display()));
    }
    if files.len() != 3 {
        return Err("完整匯出必須同時包含 CSV、JSON 與 Markdown 三個檔案。".to_string());
    }
    let mut total_bytes = 0_u64;
    for file in files {
        if file.file_name.contains(['/', '\\']) || file.file_name.contains("..") {
            return Err(format!("收工卡匯出檔名不合法：{}", file.file_name));
        }
        validate_review_export_path(&folder.join(&file.file_name))?;
        total_bytes = total_bytes.saturating_add(file.contents.len() as u64);
    }
    if total_bytes > MAX_BACKUP_BYTES {
        return Err("收工卡匯出內容超過 20 MB。".to_string());
    }
    for file in files {
        write_review_export_file(&folder.join(&file.file_name), &file.contents)?;
    }
    Ok(total_bytes)
}

#[cfg(test)]
mod tests {
    use super::{read_backup_file, write_backup_file, write_review_export_bundle_files, write_review_export_file, ReviewExportFile};
    use std::fs;

    fn temp_folder(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("focus-compass-{name}-{}", std::process::id()))
    }

    #[test]
    fn backup_round_trip_writes_and_reads_json() {
        let folder = temp_folder("round-trip");
        let payload = r#"{"version":2,"tasks":[]}"#;
        let bytes = write_backup_file(&folder, "backup.json", payload).expect("write backup");
        let restored = read_backup_file(&folder.join("backup.json")).expect("read backup");
        assert_eq!(bytes, payload.len() as u64);
        assert_eq!(restored, payload);
        fs::remove_dir_all(folder).expect("clean temporary backup folder");
    }

    #[test]
    fn read_backup_rejects_non_json_extension() {
        let folder = temp_folder("extension");
        fs::create_dir_all(&folder).expect("create temporary folder");
        let path = folder.join("backup.txt");
        fs::write(&path, "{}").expect("write test file");
        assert!(read_backup_file(&path).unwrap_err().contains("JSON"));
        fs::remove_dir_all(folder).expect("clean temporary backup folder");
    }

    #[test]
    fn daily_review_writes_supported_exports_and_rejects_other_extensions() {
        let folder = temp_folder("daily-review");
        fs::create_dir_all(&folder).expect("create temporary folder");
        let markdown = "# 今日收工卡\n\n感謝今天完成一小步。\n";
        let path = folder.join("review.md");
        let bytes = write_review_export_file(&path, markdown).expect("write daily review");
        assert_eq!(bytes, markdown.len() as u64);
        assert_eq!(fs::read_to_string(&path).expect("read daily review"), markdown);
        write_review_export_file(&folder.join("review.csv"), "date,focused_minutes\n")
            .expect("write csv review export");
        write_review_export_file(&folder.join("review.json"), "{\"cards\":[]}")
            .expect("write json review export");
        assert!(write_review_export_file(&folder.join("review.txt"), markdown)
            .unwrap_err()
            .contains("CSV"));
        fs::remove_dir_all(folder).expect("clean temporary folder");
    }

    #[test]
    fn daily_review_bundle_writes_all_three_formats() {
        let folder = temp_folder("daily-review-bundle");
        fs::create_dir_all(&folder).expect("create temporary folder");
        let files = vec![
            ReviewExportFile { file_name: "reviews.csv".into(), contents: "date,focused_minutes\n".into() },
            ReviewExportFile { file_name: "reviews.json".into(), contents: "{\"cards\":[]}".into() },
            ReviewExportFile { file_name: "reviews.md".into(), contents: "# 收工卡\n".into() },
        ];
        let bytes = write_review_export_bundle_files(&folder, &files).expect("write all formats");
        assert!(bytes > 0);
        assert!(folder.join("reviews.csv").is_file());
        assert!(folder.join("reviews.json").is_file());
        assert!(folder.join("reviews.md").is_file());
        fs::remove_dir_all(folder).expect("clean temporary folder");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "initialize_focus_compass",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:focus-compass.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![default_backup_folder, write_backup, read_backup, write_review_export, write_review_export_bundle])
        .run(tauri::generate_context!())
        .expect("無法啟動步步桌面程式");
}
