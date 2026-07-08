use std::collections::HashMap;
use std::io::Write;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use crate::app_config::{AppType, InstalledSkill, McpApps, McpServer};
use crate::services::{McpService, SkillService};
use crate::store::AppState;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkynetMcpServerPayload {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
}

fn parse_app_type(app: &str) -> Result<AppType, String> {
    AppType::from_str(app).map_err(|e| e.to_string())
}

fn non_empty(value: &str) -> bool {
    !value.trim().is_empty()
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn map_skynet_mcp_server(
    payload: SkynetMcpServerPayload,
    current_app: &AppType,
) -> Result<McpServer, String> {
    let id = payload.id.trim();
    if id.is_empty() {
        return Err("Skynet MCP server id is required".to_string());
    }

    let fallback_name = payload.name.trim();
    if fallback_name.is_empty() {
        return Err("Skynet MCP server name is required".to_string());
    }

    let kind = payload.kind.trim().to_lowercase();
    let mut server = json!({ "type": kind });

    match kind.as_str() {
        "stdio" => {
            let command = payload
                .command
                .as_deref()
                .filter(|value| non_empty(value))
                .ok_or_else(|| "Skynet stdio MCP server command is required".to_string())?;
            server["command"] = json!(command.trim());

            if let Some(args) = payload.args.filter(|args| !args.is_empty()) {
                server["args"] = json!(args);
            }
            if let Some(env) = payload.env.filter(|env| !env.is_empty()) {
                server["env"] = json!(env);
            }
            if let Some(cwd) = clean_optional(payload.cwd) {
                server["cwd"] = json!(cwd);
            }
        }
        "http" | "sse" => {
            let url = payload
                .url
                .as_deref()
                .filter(|value| non_empty(value))
                .ok_or_else(|| "Skynet remote MCP server url is required".to_string())?;
            server["url"] = json!(url.trim());

            if let Some(headers) = payload.headers.filter(|headers| !headers.is_empty()) {
                server["headers"] = json!(headers);
            }
        }
        other => {
            return Err(format!(
                "Unsupported Skynet MCP server type '{other}'. Allowed: stdio, http, sse"
            ));
        }
    }

    let mut apps = McpApps::default();
    apps.set_enabled_for(current_app, true);

    Ok(McpServer {
        id: id.to_string(),
        name: clean_optional(payload.display_name).unwrap_or_else(|| fallback_name.to_string()),
        server,
        apps,
        description: clean_optional(payload.description),
        homepage: None,
        docs: None,
        tags: vec!["skynet".to_string()],
    })
}

pub fn map_skynet_mcp_server_for_test(
    payload: SkynetMcpServerPayload,
    current_app: &AppType,
) -> Result<McpServer, String> {
    map_skynet_mcp_server(payload, current_app)
}

#[tauri::command]
pub fn install_skynet_skill_zip(
    bytes: Vec<u8>,
    current_app: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<InstalledSkill>, String> {
    if bytes.is_empty() {
        return Err("Skynet skill zip is empty".to_string());
    }

    let app_type = parse_app_type(&current_app)?;
    let mut zip_file = tempfile::Builder::new()
        .prefix("skynet-skill-")
        .suffix(".zip")
        .tempfile()
        .map_err(|e| e.to_string())?;
    zip_file.write_all(&bytes).map_err(|e| e.to_string())?;
    zip_file.flush().map_err(|e| e.to_string())?;

    SkillService::install_from_zip(&app_state.db, zip_file.path(), &app_type)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn install_skynet_mcp_server(
    server: SkynetMcpServerPayload,
    current_app: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let app_type = parse_app_type(&current_app)?;
    let mapped = map_skynet_mcp_server(server, &app_type)?;
    McpService::upsert_server(&app_state, mapped).map_err(|e| e.to_string())
}
