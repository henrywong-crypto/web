use axum::{
    Json,
    extract::{Path as RoutePath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chat_settings::{
    get_vm_claude_json_raw, parse_mcp_servers, remove_mcp_server, set_vm_claude_json,
    upsert_mcp_server,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{
    handlers::UserVm,
    state::{AppError, AppState},
};

#[derive(Serialize)]
struct McpServerEntry {
    name: String,
    #[serde(rename = "type")]
    type_: String,
    url: String,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    headers: HashMap<String, String>,
}

#[derive(Deserialize)]
pub(crate) struct AddMcpServerBody {
    name: String,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
}

/// Only allow server names that are safe identifiers.
pub(crate) fn is_valid_server_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Only allow URL strings that look like valid HTTP(S) URLs.
pub(crate) fn is_valid_url(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://"))
        && url.len() <= 2048
        && url.chars().all(|c| c.is_ascii_graphic())
}

/// Only allow header keys/values that are safe ASCII strings.
pub(crate) fn is_valid_header(key: &str, value: &str) -> bool {
    !key.is_empty()
        && key.len() <= 256
        && key.chars().all(|c| c.is_ascii_graphic())
        && value.len() <= 4096
        && value.chars().all(|c| c.is_ascii_graphic() || c == ' ')
}

pub(crate) async fn list_handler(
    user_vm: UserVm,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let raw = get_vm_claude_json_raw(
        user_vm.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
    )
    .await?;
    let servers = parse_mcp_servers(raw.trim())?;
    let entries: Vec<McpServerEntry> = servers
        .into_iter()
        .map(|(name, val)| {
            let type_ = val
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("http")
                .to_string();
            let url = val
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let headers = val
                .get("headers")
                .and_then(|v| v.as_object())
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            McpServerEntry {
                name,
                type_,
                url,
                headers,
            }
        })
        .collect();
    Ok(Json(entries).into_response())
}

pub(crate) async fn add_handler(
    user_vm: UserVm,
    State(state): State<AppState>,
    Json(body): Json<AddMcpServerBody>,
) -> Result<Response, AppError> {
    if !is_valid_server_name(&body.name) {
        return Ok((StatusCode::BAD_REQUEST, "Invalid server name").into_response());
    }
    if !is_valid_url(&body.url) {
        return Ok((StatusCode::BAD_REQUEST, "Invalid URL").into_response());
    }
    for (key, value) in &body.headers {
        if !is_valid_header(key, value) {
            return Ok((StatusCode::BAD_REQUEST, "Invalid header").into_response());
        }
    }

    let raw = get_vm_claude_json_raw(
        user_vm.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
    )
    .await?;

    let existing = parse_mcp_servers(raw.trim())?;
    if existing.contains_key(&body.name) {
        return Ok((StatusCode::CONFLICT, "Server name already exists").into_response());
    }

    let mut server = serde_json::json!({
        "type": "http",
        "url": body.url,
    });
    if !body.headers.is_empty() {
        server["headers"] = serde_json::to_value(&body.headers)?;
    }

    let updated = upsert_mcp_server(raw.trim(), &body.name, server)?;
    set_vm_claude_json(
        user_vm.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
        &updated,
    )
    .await?;
    Ok(StatusCode::CREATED.into_response())
}

pub(crate) async fn delete_handler(
    user_vm: UserVm,
    State(state): State<AppState>,
    RoutePath(name): RoutePath<String>,
) -> Result<Response, AppError> {
    if !is_valid_server_name(&name) {
        return Ok((StatusCode::BAD_REQUEST, "Invalid server name").into_response());
    }

    if name == "gemini-websearch" {
        return Ok((StatusCode::FORBIDDEN, "Cannot delete built-in server").into_response());
    }

    let raw = get_vm_claude_json_raw(
        user_vm.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
    )
    .await?;

    let Some(updated) = remove_mcp_server(raw.trim(), &name)? else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };

    set_vm_claude_json(
        user_vm.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
        &updated,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[cfg(test)]
mod tests {
    use crate::mcp::{is_valid_header, is_valid_server_name, is_valid_url};

    // --- is_valid_server_name ---

    #[test]
    fn valid_server_names() {
        assert!(is_valid_server_name("my-server"));
        assert!(is_valid_server_name("server_1"));
        assert!(is_valid_server_name("server.v2"));
        assert!(is_valid_server_name("a"));
    }

    #[test]
    fn invalid_server_names() {
        assert!(!is_valid_server_name(""));
        assert!(!is_valid_server_name("my server"));
        assert!(!is_valid_server_name("server;drop"));
        assert!(!is_valid_server_name("server\nname"));
        assert!(!is_valid_server_name(&"a".repeat(129)));
    }

    #[test]
    fn server_name_at_max_length() {
        assert!(is_valid_server_name(&"a".repeat(128)));
    }

    // --- is_valid_url ---

    #[test]
    fn valid_urls() {
        assert!(is_valid_url("https://example.com/mcp"));
        assert!(is_valid_url("http://localhost:8080/mcp"));
        assert!(is_valid_url("https://34.49.122.135/mcp"));
    }

    #[test]
    fn invalid_urls() {
        assert!(!is_valid_url(""));
        assert!(!is_valid_url("ftp://example.com"));
        assert!(!is_valid_url("not-a-url"));
        assert!(!is_valid_url("https://example.com/mcp with spaces"));
    }

    #[test]
    fn url_at_max_length() {
        let long_url = format!("https://example.com/{}", "a".repeat(2048 - 20));
        assert!(is_valid_url(&long_url));
    }

    #[test]
    fn url_over_max_length() {
        let long_url = format!("https://example.com/{}", "a".repeat(2049));
        assert!(!is_valid_url(&long_url));
    }

    // --- is_valid_header ---

    #[test]
    fn valid_headers() {
        assert!(is_valid_header("Authorization", "Bearer sk-abc123"));
        assert!(is_valid_header("X-API-Key", "my-key"));
        assert!(is_valid_header("Content-Type", "application/json"));
    }

    #[test]
    fn invalid_headers() {
        assert!(!is_valid_header("", "value"));
        assert!(!is_valid_header("key with space", "value"));
        assert!(!is_valid_header("key\nnewline", "value"));
        assert!(!is_valid_header("key", "value\nnewline"));
    }

    #[test]
    fn header_key_at_max_length() {
        assert!(is_valid_header(&"a".repeat(256), "value"));
        assert!(!is_valid_header(&"a".repeat(257), "value"));
    }

    #[test]
    fn header_value_at_max_length() {
        assert!(is_valid_header("key", &"a".repeat(4096)));
        assert!(!is_valid_header("key", &"a".repeat(4097)));
    }
}
