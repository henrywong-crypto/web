use anyhow::Context;
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chat_settings::{get_vm_claude_json_raw, set_vm_claude_json, upsert_mcp_server};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tower_sessions::Session;
use tracing::{error, info};
use url::Url;

use crate::{
    auth::User,
    state::{AppError, AppState, find_user_vm},
};

// ── PKCE helpers ─────────────────────────────────────────────────────────

/// Generate a cryptographically random code_verifier (43–128 chars, unreserved charset).
fn generate_code_verifier() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Compute S256 code_challenge from a code_verifier.
fn compute_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

/// Generate a random state nonce for CSRF protection.
fn generate_state() -> String {
    let bytes: [u8; 16] = rand::rng().random();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Extract origin (scheme + host + port) and path component from a URL.
/// Path has trailing slash stripped. Returns (origin, path) where path may be empty.
fn origin_and_path(raw_url: &str) -> Result<(String, String), url::ParseError> {
    let parsed = Url::parse(raw_url)?;
    let mut origin = format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap_or(""));
    if let Some(port) = parsed.port() {
        origin.push_str(&format!(":{port}"));
    }
    let path = parsed.path().trim_end_matches('/').to_string();
    Ok((origin, path))
}

/// Build RFC 9728 protected resource discovery URLs for a given MCP resource URL.
fn build_protected_resource_urls(origin: &str, path: &str) -> Vec<String> {
    if path.is_empty() {
        vec![format!("{origin}/.well-known/oauth-protected-resource")]
    } else {
        vec![
            format!("{origin}/.well-known/oauth-protected-resource{path}"),
            format!("{origin}/.well-known/oauth-protected-resource"),
        ]
    }
}

/// Build RFC 8414 / OIDC authorization server metadata discovery URLs.
fn build_auth_server_discovery_urls(origin: &str, path: &str, full_url: &str) -> Vec<String> {
    if path.is_empty() {
        vec![
            format!("{origin}/.well-known/oauth-authorization-server"),
            format!("{origin}/.well-known/openid-configuration"),
        ]
    } else {
        vec![
            format!("{origin}/.well-known/oauth-authorization-server{path}"),
            format!("{origin}/.well-known/openid-configuration{path}"),
            format!("{full_url}/.well-known/openid-configuration"),
        ]
    }
}

// ── Types ────────────────────────────────────────────────────────────────

/// OAuth 2.0 Authorization Server Metadata (subset we care about).
#[derive(Deserialize, Serialize, Clone, Debug)]
struct OAuthMetadata {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    registration_endpoint: Option<String>,
    #[serde(default)]
    scopes_supported: Option<Vec<String>>,
    #[serde(default)]
    code_challenge_methods_supported: Option<Vec<String>>,
    #[serde(default)]
    grant_types_supported: Option<Vec<String>>,
    #[serde(default)]
    token_endpoint_auth_methods_supported: Option<Vec<String>>,
}

/// Protected Resource Metadata per RFC 9728.
#[derive(Deserialize, Debug)]
struct ProtectedResourceMetadata {
    #[serde(default)]
    authorization_servers: Vec<String>,
}

#[derive(Serialize)]
struct DiscoverResponse {
    oauth: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<OAuthMetadata>,
}

#[derive(Deserialize)]
pub(crate) struct DiscoverQuery {
    url: String,
}

#[derive(Deserialize)]
pub(crate) struct RegisterBody {
    registration_endpoint: String,
    client_name: String,
    redirect_uri: String,
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct RegisterResponse {
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct OAuthStartBody {
    authorization_endpoint: String,
    token_endpoint: String,
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
    #[serde(default)]
    scopes: Option<String>,
    redirect_uri: String,
    mcp_url: String,
    server_name: String,
}

#[derive(Deserialize)]
pub(crate) struct OAuthCallbackQuery {
    code: String,
    state: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

// ── Handlers ─────────────────────────────────────────────────────────────

/// GET /api/mcp-servers/oauth-discover?url=<mcp_url>
///
/// Probe an MCP server for OAuth authorization server metadata.
/// Follows the MCP spec: RFC 9728 (protected resource) then RFC 8414 (auth server).
pub(crate) async fn discover_handler(
    Query(query): Query<DiscoverQuery>,
) -> Result<Response, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build HTTP client: {e}"))?;

    // ── Step 1: Protected Resource Discovery (RFC 9728) ──────────────────
    // Discover which authorization server protects this MCP resource.
    let (resource_origin, resource_path) =
        origin_and_path(&query.url).map_err(|_| anyhow::anyhow!("invalid URL"))?;

    let protected_resource_urls = build_protected_resource_urls(&resource_origin, &resource_path);

    let mut auth_server_url: Option<String> = None;
    for url in &protected_resource_urls {
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                if let Ok(meta) = resp.json::<ProtectedResourceMetadata>().await {
                    if let Some(first) = meta.authorization_servers.into_iter().next() {
                        auth_server_url = Some(first);
                        break;
                    }
                }
            }
        }
    }

    // Fallback: treat the MCP server's base URL as the authorization server
    let auth_server_url = auth_server_url.unwrap_or_else(|| resource_origin.clone());

    // ── Step 2: Authorization Server Metadata Discovery (RFC 8414 / OIDC) ─
    let (auth_origin, auth_path) =
        origin_and_path(&auth_server_url).map_err(|_| anyhow::anyhow!("invalid auth server URL"))?;

    let discovery_urls = build_auth_server_discovery_urls(&auth_origin, &auth_path, &auth_server_url);

    for url in &discovery_urls {
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                if let Ok(metadata) = resp.json::<OAuthMetadata>().await {
                    return Ok(Json(DiscoverResponse {
                        oauth: true,
                        metadata: Some(metadata),
                    })
                    .into_response());
                }
            }
        }
    }

    Ok(Json(DiscoverResponse {
        oauth: false,
        metadata: None,
    })
    .into_response())
}

/// POST /api/mcp-servers/oauth-register
///
/// Dynamic Client Registration per RFC 7591.
pub(crate) async fn register_handler(
    Json(body): Json<RegisterBody>,
) -> Result<Response, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build HTTP client: {e}"))?;

    let mut reg_request = serde_json::json!({
        "client_name": body.client_name,
        "redirect_uris": [body.redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });
    if let Some(ref scope) = body.scope {
        reg_request["scope"] = serde_json::Value::String(scope.clone());
    }

    let resp = client
        .post(&body.registration_endpoint)
        .header("Content-Type", "application/json")
        .header("MCP-Protocol-Version", "2025-03-26")
        .json(&reg_request)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("registration request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        error!("mcp oauth registration failed: {status} {body_text}");
        return Ok((
            StatusCode::BAD_GATEWAY,
            format!("registration failed: {status} {body_text}"),
        )
            .into_response());
    }

    let reg_resp: RegisterResponse = resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("failed to parse registration response: {e}"))?;

    Ok(Json(reg_resp).into_response())
}

/// POST /api/mcp-servers/oauth-start
///
/// Generate PKCE parameters, store state in session, return authorization URL.
pub(crate) async fn start_handler(
    session: Session,
    Json(body): Json<OAuthStartBody>,
) -> Result<Response, AppError> {
    let code_verifier = generate_code_verifier();
    let code_challenge = compute_code_challenge(&code_verifier);
    let state = generate_state();

    let redirect_uri = &body.redirect_uri;

    // Store OAuth state in session
    session
        .insert("mcp_oauth_state", &state)
        .await
        .context("failed to store mcp oauth state")?;
    session
        .insert("mcp_oauth_pkce_verifier", &code_verifier)
        .await
        .context("failed to store mcp oauth pkce verifier")?;
    session
        .insert("mcp_oauth_token_endpoint", &body.token_endpoint)
        .await
        .context("failed to store mcp oauth token endpoint")?;
    session
        .insert("mcp_oauth_client_id", &body.client_id)
        .await
        .context("failed to store mcp oauth client id")?;
    if let Some(ref secret) = body.client_secret {
        session
            .insert("mcp_oauth_client_secret", secret)
            .await
            .context("failed to store mcp oauth client secret")?;
    }
    session
        .insert("mcp_oauth_mcp_url", &body.mcp_url)
        .await
        .context("failed to store mcp oauth mcp url")?;
    session
        .insert("mcp_oauth_redirect_uri", redirect_uri)
        .await
        .context("failed to store mcp oauth redirect uri")?;
    session
        .insert("mcp_oauth_server_name", &body.server_name)
        .await
        .context("failed to store mcp oauth server name")?;

    // Build authorization URL
    let mut auth_url =
        Url::parse(&body.authorization_endpoint).context("invalid authorization endpoint URL")?;
    auth_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &body.client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);
    if let Some(ref scopes) = body.scopes {
        auth_url
            .query_pairs_mut()
            .append_pair("scope", scopes);
    }

    Ok(Json(serde_json::json!({ "redirect": auth_url.to_string() })).into_response())
}

/// GET /callback/mcp-oauth?code=...&state=...
///
/// Handle the OAuth callback: validate state, exchange code for token, store MCP server config.
pub(crate) async fn callback_handler(
    query: Query<OAuthCallbackQuery>,
    _user: User,
    session: Session,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    // Validate state nonce
    let stored_state = session
        .remove::<String>("mcp_oauth_state")
        .await
        .context("failed to retrieve oauth state from session")?;

    if stored_state.as_deref() != Some(&query.state) {
        error!("mcp oauth state mismatch");
        return Ok(Redirect::to("/?mcp_oauth=error").into_response());
    }

    // Retrieve session data
    let pkce_verifier = session
        .remove::<String>("mcp_oauth_pkce_verifier")
        .await
        .context("failed to retrieve pkce verifier")?
        .context("pkce verifier missing")?;
    let token_endpoint = session
        .remove::<String>("mcp_oauth_token_endpoint")
        .await
        .context("failed to retrieve token endpoint")?
        .context("token endpoint missing")?;
    let client_id = session
        .remove::<String>("mcp_oauth_client_id")
        .await
        .context("failed to retrieve client id")?
        .context("client id missing")?;
    let client_secret = session
        .remove::<String>("mcp_oauth_client_secret")
        .await
        .unwrap_or(None);
    let mcp_url = session
        .remove::<String>("mcp_oauth_mcp_url")
        .await
        .context("failed to retrieve mcp url")?
        .context("mcp url missing")?;
    let server_name = session
        .remove::<String>("mcp_oauth_server_name")
        .await
        .context("failed to retrieve server name")?
        .context("server name missing")?;
    let redirect_uri = session
        .remove::<String>("mcp_oauth_redirect_uri")
        .await
        .context("failed to retrieve redirect uri")?
        .context("redirect uri missing")?;

    // Exchange authorization code for tokens
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build HTTP client: {e}"))?;

    let mut token_params = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", query.code.clone()),
        ("redirect_uri", redirect_uri),
        ("code_verifier", pkce_verifier),
        ("client_id", client_id),
    ];
    if let Some(secret) = client_secret {
        token_params.push(("client_secret", secret));
    }

    let token_resp = http_client
        .post(&token_endpoint)
        .form(&token_params)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("token exchange failed: {e}"))?;

    if !token_resp.status().is_success() {
        let status = token_resp.status();
        let body = token_resp.text().await.unwrap_or_default();
        error!("token exchange failed: {status} {body}");
        return Ok(Redirect::to("/?mcp_oauth=error").into_response());
    }

    let tokens: TokenResponse = token_resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("failed to parse token response: {e}"))?;

    info!("mcp oauth token exchange successful for server: {server_name}");

    // Find user's VM to write the config
    let user_email = session
        .get::<String>("email")
        .await
        .ok()
        .flatten();

    if user_email.is_none() {
        error!("mcp oauth callback: no email in session — cannot write MCP server config");
        return Ok(Redirect::to("/?mcp_oauth=error&reason=no_session").into_response());
    }

    let user_id = if let Some(email) = &user_email {
        store::get_user_by_email(&state.db, email)
            .await
            .ok()
            .flatten()
            .map(|u| u.id)
    } else {
        None
    };

    let Some(user_id) = user_id else {
        error!("mcp oauth callback: user not found in DB for email {:?}", user_email);
        return Ok(Redirect::to("/?mcp_oauth=error&reason=user_not_found").into_response());
    };

    let vm_info = match find_user_vm(&state.vms, user_id) {
        Ok(Some(vm)) => vm,
        Ok(None) => {
            error!("mcp oauth callback: no VM found for user {user_id}");
            return Ok(Redirect::to("/?mcp_oauth=error&reason=no_vm").into_response());
        }
        Err(e) => {
            error!("mcp oauth callback: failed to find VM for user {user_id}: {e}");
            return Ok(Redirect::to("/?mcp_oauth=error&reason=vm_error").into_response());
        }
    };

    // Read current ~/.claude.json from VM
    let raw = get_vm_claude_json_raw(
        vm_info.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
    )
    .await
    .unwrap_or_else(|_| "{}".to_string());

    // Build MCP server entry with OAuth token
    let mut server = serde_json::json!({
        "type": "http",
        "url": mcp_url,
        "headers": {
            "Authorization": format!("Bearer {}", tokens.access_token),
        },
    });
    if let Some(ref refresh) = tokens.refresh_token {
        server["_refresh_token"] = serde_json::Value::String(refresh.clone());
    }

    // Upsert and write back
    let updated = upsert_mcp_server(raw.trim(), &server_name, server)
        .map_err(|e| anyhow::anyhow!("failed to upsert MCP server config: {e}"))?;

    if let Err(e) = set_vm_claude_json(
        vm_info.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
        &updated,
    )
    .await
    {
        error!("mcp oauth callback: failed to write ~/.claude.json to VM: {e}");
        return Ok(Redirect::to("/?mcp_oauth=error&reason=write_failed").into_response());
    }

    info!("mcp oauth: successfully wrote server '{server_name}' config to VM");

    Ok(Redirect::to("/?mcp_oauth=success").into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── PKCE tests ──────────────────────────────────────────────────────

    #[test]
    fn code_verifier_has_valid_length() {
        let verifier = generate_code_verifier();
        // 32 bytes → 43 base64url chars (no padding)
        assert_eq!(verifier.len(), 43);
    }

    #[test]
    fn code_verifier_is_url_safe() {
        let verifier = generate_code_verifier();
        assert!(verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn code_challenge_is_deterministic_for_same_verifier() {
        let challenge1 = compute_code_challenge("test_verifier_123");
        let challenge2 = compute_code_challenge("test_verifier_123");
        assert_eq!(challenge1, challenge2);
    }

    #[test]
    fn code_challenge_differs_for_different_verifiers() {
        let c1 = compute_code_challenge("verifier_a");
        let c2 = compute_code_challenge("verifier_b");
        assert_ne!(c1, c2);
    }

    #[test]
    fn code_challenge_is_base64url_encoded() {
        let challenge = compute_code_challenge("my_verifier");
        assert!(challenge
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        // SHA256 → 32 bytes → 43 base64url chars
        assert_eq!(challenge.len(), 43);
    }

    // ── State tests ─────────────────────────────────────────────────────

    #[test]
    fn state_nonce_has_valid_length() {
        let state = generate_state();
        // 16 bytes → 22 base64url chars
        assert_eq!(state.len(), 22);
    }

    #[test]
    fn state_nonce_is_url_safe() {
        let state = generate_state();
        assert!(state
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn state_nonces_are_unique() {
        let s1 = generate_state();
        let s2 = generate_state();
        assert_ne!(s1, s2);
    }

    // ── origin_and_path tests ──────────────────────────────────────────

    #[test]
    fn origin_and_path_extracts_both() {
        let (origin, path) = origin_and_path("https://api.example.com/v1/mcp").unwrap();
        assert_eq!(origin, "https://api.example.com");
        assert_eq!(path, "/v1/mcp");
    }

    #[test]
    fn origin_and_path_strips_trailing_slash() {
        let (origin, path) = origin_and_path("https://example.com/mcp/").unwrap();
        assert_eq!(origin, "https://example.com");
        assert_eq!(path, "/mcp");
    }

    #[test]
    fn origin_and_path_root_url() {
        let (origin, path) = origin_and_path("https://mcp.figma.com").unwrap();
        assert_eq!(origin, "https://mcp.figma.com");
        assert_eq!(path, "");
    }

    #[test]
    fn origin_and_path_preserves_port() {
        let (origin, path) = origin_and_path("https://localhost:8443/mcp").unwrap();
        assert_eq!(origin, "https://localhost:8443");
        assert_eq!(path, "/mcp");
    }

    #[test]
    fn origin_and_path_rejects_invalid() {
        assert!(origin_and_path("not a url").is_err());
    }

    // ── protected resource discovery URL tests ─────────────────────────

    #[test]
    fn protected_resource_urls_root_url() {
        let urls = build_protected_resource_urls("https://mcp.figma.com", "");
        assert_eq!(urls, vec![
            "https://mcp.figma.com/.well-known/oauth-protected-resource",
        ]);
    }

    #[test]
    fn protected_resource_urls_with_path() {
        let urls = build_protected_resource_urls("https://mcp.figma.com", "/v1");
        assert_eq!(urls, vec![
            "https://mcp.figma.com/.well-known/oauth-protected-resource/v1",
            "https://mcp.figma.com/.well-known/oauth-protected-resource",
        ]);
    }

    #[test]
    fn protected_resource_urls_with_deep_path() {
        let urls = build_protected_resource_urls("https://example.com", "/api/v2/mcp");
        assert_eq!(urls, vec![
            "https://example.com/.well-known/oauth-protected-resource/api/v2/mcp",
            "https://example.com/.well-known/oauth-protected-resource",
        ]);
    }

    // ── auth server discovery URL tests ────────────────────────────────

    #[test]
    fn auth_server_urls_root_url() {
        let urls = build_auth_server_discovery_urls(
            "https://auth.example.com", "", "https://auth.example.com",
        );
        assert_eq!(urls, vec![
            "https://auth.example.com/.well-known/oauth-authorization-server",
            "https://auth.example.com/.well-known/openid-configuration",
        ]);
    }

    #[test]
    fn auth_server_urls_with_path() {
        let urls = build_auth_server_discovery_urls(
            "https://auth.example.com", "/v1", "https://auth.example.com/v1",
        );
        assert_eq!(urls, vec![
            "https://auth.example.com/.well-known/oauth-authorization-server/v1",
            "https://auth.example.com/.well-known/openid-configuration/v1",
            "https://auth.example.com/v1/.well-known/openid-configuration",
        ]);
    }

    #[test]
    fn auth_server_urls_with_port() {
        let urls = build_auth_server_discovery_urls(
            "https://localhost:8443", "/mcp", "https://localhost:8443/mcp",
        );
        assert_eq!(urls, vec![
            "https://localhost:8443/.well-known/oauth-authorization-server/mcp",
            "https://localhost:8443/.well-known/openid-configuration/mcp",
            "https://localhost:8443/mcp/.well-known/openid-configuration",
        ]);
    }
}
