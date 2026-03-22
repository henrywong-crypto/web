use anyhow::{Context, Result, anyhow};
use axum::{
    Json,
    extract::{FromRequestParts, Multipart, Path as AxumPath, Query, State},
    http::{StatusCode, request::Parts},
    response::{Html, IntoResponse, Redirect, Response},
};
use chat_history::{delete_chat_session, fetch_chat_history, list_chat_sessions};
use common::validate_within_dir;
use firecracker_manager::create_vm;
use futures::TryStreamExt;
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use sftp_client::open_sftp_session;
use ssh_client::connect_ssh;
use std::{
    collections::HashSet,
    io::{Error as IoError, ErrorKind},
    net::Ipv4Addr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use store::get_user_by_email;
use tokio::{
    io::{AsyncRead, AsyncWriteExt},
    time::timeout,
};
use tokio_util::io::StreamReader;
use tower_sessions::Session;
use tracing::{error, info};
use uuid::Uuid;
use vm_lifecycle::{
    VmEntry, VmRegistry, build_user_rootfs_path, build_vm_config, build_vm_config_without_iam,
    ensure_user_rootfs, fetch_host_iam_credentials, find_user_rootfs,
};

use crate::{
    auth::User,
    csrf::get_csrf_token,
    state::{AppError, AppState, find_user_vm},
    templates::render_terminal_page,
};

const LOCK_TIMEOUT_SECS: u64 = 30;
const SFTP_OP_TIMEOUT_SECS: u64 = 30;

#[derive(Serialize)]
pub(crate) struct CsrfTokenResponse {
    csrf_token: String,
}

pub(crate) async fn get_csrf_token_handler(
    _user: User,
    session: Session,
) -> Result<Response, AppError> {
    let csrf_token = get_csrf_token(&session).await?;
    Ok(Json(CsrfTokenResponse { csrf_token }).into_response())
}

fn is_user_provisioning(state: &AppState, user_id: Uuid) -> Result<bool, AppError> {
    let provisioning = state
        .provisioning_users
        .lock()
        .map_err(|_| anyhow!("provisioning lock poisoned"))?;
    Ok(provisioning.contains(&user_id))
}

fn register_vm(vms: &VmRegistry, vm_id: String, vm_entry: VmEntry) -> Result<(), AppError> {
    let mut registry = vms
        .lock()
        .map_err(|_| anyhow!("vm registry lock poisoned"))?;
    registry.insert(vm_id, vm_entry);
    Ok(())
}

pub(crate) struct UserVm {
    pub(crate) user_id: Uuid,
    pub(crate) vm_id: String,
    pub(crate) guest_ip: Ipv4Addr,
}

impl FromRequestParts<AppState> for UserVm {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = User::from_request_parts(parts, state)
            .await
            .map_err(IntoResponse::into_response)?;
        let db_user = get_user_by_email(&state.db, &user.email)
            .await
            .map_err(|_| {
                error!("db error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "An internal error occurred",
                )
                    .into_response()
            })?
            .ok_or_else(|| Redirect::to("/login").into_response())?;
        let (vm_id, guest_ip) = match find_user_vm(&state.vms, db_user.id).map_err(|_| {
            error!("vm registry error");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "An internal error occurred",
            )
                .into_response()
        })? {
            Some(entry) => entry,
            None => {
                if is_user_provisioning(state, db_user.id).map_err(|_| {
                    error!("provisioning check error");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "An internal error occurred",
                    )
                        .into_response()
                })? {
                    return Err((
                        StatusCode::SERVICE_UNAVAILABLE,
                        "VM is still starting, please try again",
                    )
                        .into_response());
                }
                let user_vm = provision_new_vm(state, db_user.id)
                    .await
                    .map_err(IntoResponse::into_response)?;
                if let Err(_) = write_initial_settings(parts, state, user_vm.guest_ip).await {
                    error!("failed to write initial settings");
                }
                return Ok(user_vm);
            }
        };
        Ok(UserVm {
            user_id: db_user.id,
            vm_id,
            guest_ip,
        })
    }
}

async fn write_initial_settings(parts: &mut Parts, state: &AppState, guest_ip: Ipv4Addr) -> Result<()> {
    let session = Session::from_request_parts(parts, state).await.ok();
    let gateway_key = match &session {
        Some(s) => s.get::<String>("gateway_api_key").await.ok().flatten(),
        None => None,
    };

    let content = match gateway_key {
        Some(key) => chat_settings::build_api_key_settings_json(
            &key,
            state.config.anthropic_base_url.as_deref(),
            &state.config.anthropic_default_haiku_model,
            &state.config.anthropic_default_sonnet_model,
            &state.config.anthropic_default_opus_model,
            state.config.enable_mcp,
        )?,
        None => return write_bedrock_settings(state, guest_ip).await,
    };

    chat_settings::set_vm_settings(
        guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
        &content,
    )
    .await
}

async fn write_gateway_settings_with_key(state: &AppState, guest_ip: Ipv4Addr, gateway_key: &str) -> Result<()> {
    let content = chat_settings::build_api_key_settings_json(
        gateway_key,
        state.config.anthropic_base_url.as_deref(),
        &state.config.anthropic_default_haiku_model,
        &state.config.anthropic_default_sonnet_model,
        &state.config.anthropic_default_opus_model,
        state.config.enable_mcp,
    )?;
    chat_settings::set_vm_settings(
        guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
        &content,
    )
    .await
}

async fn write_bedrock_settings(state: &AppState, guest_ip: Ipv4Addr) -> Result<()> {
    if !state.config.use_iam_creds {
        return Ok(());
    }
    let content = chat_settings::build_bedrock_settings_json(
        &state.config.anthropic_default_haiku_model,
        &state.config.anthropic_default_sonnet_model,
        &state.config.anthropic_default_opus_model,
    )?;
    chat_settings::set_vm_settings(
        guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
        &content,
    )
    .await
}

fn remove_user_vm(vms: &VmRegistry, user_id: Uuid) -> Result<()> {
    let _removed = {
        let mut registry = vms
            .lock()
            .map_err(|_| anyhow!("vm registry lock poisoned"))?;
        let vm_ids: Vec<String> = registry
            .iter()
            .filter(|(_, e)| e.user_id == user_id)
            .map(|(id, _)| id.clone())
            .collect();
        vm_ids
            .into_iter()
            .filter_map(|id| registry.remove(&id))
            .collect::<Vec<_>>()
    };
    Ok(())
}

pub(crate) async fn get_or_create_terminal(
    user: User,
    session: Session,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let Some(db_user) = get_user_by_email(&state.db, &user.email).await? else {
        return Ok(Redirect::to("/login").into_response());
    };
    let has_user_rootfs = find_user_rootfs(&state.config.user_rootfs_dir, db_user.id).is_some();
    let csrf_token = get_csrf_token(&session).await?;
    Ok(Html(render_terminal_page(
        "",
        &csrf_token,
        &state.config.upload_dir,
        has_user_rootfs,
    ))
    .into_response())
}

pub(crate) async fn vm_status_handler(
    user: User,
    session: Session,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let Some(db_user) = get_user_by_email(&state.db, &user.email).await? else {
        return Ok(Redirect::to("/login").into_response());
    };
    let user_id = db_user.id;

    if let Some((vm_id, _guest_ip)) = find_user_vm(&state.vms, user_id)? {
        let has_user_rootfs =
            find_user_rootfs(&state.config.user_rootfs_dir, user_id).is_some();
        return Ok(Json(serde_json::json!({
            "status": "ready",
            "vm_id": vm_id,
            "has_user_rootfs": has_user_rootfs,
        }))
        .into_response());
    }

    if is_user_provisioning(&state, user_id)? {
        return Ok(Json(serde_json::json!({"status": "provisioning"})).into_response());
    }

    let gateway_key = session
        .get::<String>("gateway_api_key")
        .await
        .ok()
        .flatten();

    let state_clone = state.clone();
    tokio::spawn(async move {
        match provision_new_vm(&state_clone, user_id).await {
            Ok(user_vm) => {
                let result = if let Some(key) = gateway_key {
                    write_gateway_settings_with_key(&state_clone, user_vm.guest_ip, &key).await
                } else {
                    write_bedrock_settings(&state_clone, user_vm.guest_ip).await
                };
                if let Err(_) = result {
                    error!("failed to write settings to VM");
                }
            }
            Err(_) => {
                error!("background vm provisioning failed for {user_id}");
            }
        }
    });

    Ok(Json(serde_json::json!({"status": "provisioning"})).into_response())
}

fn acquire_provisioning_slot(
    state: &AppState,
    user_id: Uuid,
) -> Result<ProvisioningGuard, AppError> {
    let registry = state
        .vms
        .lock()
        .map_err(|_| anyhow!("vm registry lock poisoned"))?;
    let mut provisioning = state
        .provisioning_users
        .lock()
        .map_err(|_| anyhow!("provisioning lock poisoned"))?;
    if registry.values().any(|e| e.user_id == user_id) {
        return Err(anyhow!("VM already exists for user").into());
    }
    if !provisioning.insert(user_id) {
        return Err(anyhow!("VM provisioning already in progress for user").into());
    }
    if registry.len() + provisioning.len() > state.config.vm_max_count {
        provisioning.remove(&user_id);
        return Err(anyhow!("vm limit reached").into());
    }
    Ok(ProvisioningGuard {
        provisioning_users: Arc::clone(&state.provisioning_users),
        user_id,
    })
}

struct ProvisioningGuard {
    provisioning_users: Arc<Mutex<HashSet<Uuid>>>,
    user_id: Uuid,
}

impl Drop for ProvisioningGuard {
    fn drop(&mut self) {
        if let Ok(mut provisioning) = self.provisioning_users.lock() {
            provisioning.remove(&self.user_id);
        }
    }
}

pub(crate) async fn provision_new_vm(state: &AppState, user_id: Uuid) -> Result<UserVm, AppError> {
    let _guard = acquire_provisioning_slot(state, user_id)?;
    info!("building vm config");
    let user_rootfs = ensure_user_rootfs(
        &state.config.user_rootfs_dir,
        &state.config.rootfs_path,
        user_id,
        &state.rootfs_lock,
    )
    .await?;
    let vm_config = if state.config.use_iam_creds {
        let iam_creds = fetch_host_iam_credentials(&state.config.iam_role_name)
            .await
            .context("failed to fetch IAM credentials for VM")?;
        build_vm_config(&state.config.to_vm_build_config(), &iam_creds, &user_rootfs)?
    } else {
        build_vm_config_without_iam(&state.config.to_vm_build_config(), &user_rootfs)
    };
    let vm = create_vm(&vm_config).await?;
    info!("vm started");
    let vm_id = vm.id.clone();
    let guest_ip = vm.guest_ip();
    register_vm(
        &state.vms,
        vm_id.clone(),
        VmEntry {
            user_id,
            has_iam_creds: state.config.use_iam_creds,
            last_activity: Instant::now(),
            vm,
        },
    )?;
    Ok(UserVm {
        user_id,
        vm_id,
        guest_ip,
    })
}

async fn build_terminal_response(
    session: &Session,
    state: &AppState,
    user_id: Uuid,
    vm_id: &str,
) -> Result<Response, AppError> {
    let csrf_token = get_csrf_token(session).await?;
    let has_user_rootfs = find_user_rootfs(&state.config.user_rootfs_dir, user_id).is_some();
    Ok(Html(render_terminal_page(
        vm_id,
        &csrf_token,
        &state.config.upload_dir,
        has_user_rootfs,
    ))
    .into_response())
}

pub(crate) async fn delete_user_rootfs_handler(
    user: User,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let Some(db_user) = get_user_by_email(&state.db, &user.email).await? else {
        return Ok(Redirect::to("/login").into_response());
    };
    let rootfs_path = build_user_rootfs_path(&state.config.user_rootfs_dir, db_user.id);
    info!("deleting saved rootfs");
    remove_user_vm(&state.vms, db_user.id)?;
    let _guard = timeout(
        Duration::from_secs(LOCK_TIMEOUT_SECS),
        state.rootfs_lock.lock(),
    )
    .await
    .context("timed out waiting for rootfs lock")?;
    if let Err(e) = tokio::fs::remove_file(&rootfs_path).await
        && e.kind() != ErrorKind::NotFound
    {
        return Err(anyhow!(e).context("failed to delete user rootfs").into());
    }
    drop(_guard);
    Ok(Redirect::to("/").into_response())
}

pub(crate) async fn get_terminal_page(
    user_vm: UserVm,
    AxumPath(vm_id): AxumPath<String>,
    session: Session,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    if user_vm.vm_id != vm_id {
        return Ok((StatusCode::NOT_FOUND, "Session not found").into_response());
    }
    build_terminal_response(&session, &state, user_vm.user_id, &user_vm.vm_id).await
}

pub(crate) async fn list_chat_sessions_handler(
    user_vm: UserVm,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let sessions = list_chat_sessions(
        user_vm.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
        &state.config.ssh_user_home,
    )
    .await?;
    Ok(Json(sessions).into_response())
}

#[derive(Deserialize)]
pub(crate) struct TranscriptQuery {
    session_id: String,
    project_dir: String,
}

pub(crate) async fn get_chat_transcript_handler(
    user_vm: UserVm,
    Query(query): Query<TranscriptQuery>,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let history = fetch_chat_history(
        user_vm.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
        &query.session_id,
        Path::new(&query.project_dir),
    )
    .await?;
    Ok(Json(history).into_response())
}

#[derive(Deserialize)]
pub(crate) struct DeleteChatSessionForm {
    session_id: String,
    project_dir: String,
}

pub(crate) async fn delete_chat_session_handler(
    user_vm: UserVm,
    State(state): State<AppState>,
    Json(form): Json<DeleteChatSessionForm>,
) -> Result<Response, AppError> {
    delete_chat_session(
        user_vm.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
        &form.session_id,
        Path::new(&form.project_dir),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub(crate) async fn handle_chat_upload(
    user_vm: UserVm,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Response, AppError> {
    info!("uploading chat attachment via sftp");
    let mut ssh_handle = connect_ssh(
        user_vm.guest_ip,
        &state.config.ssh_key_path,
        &state.config.ssh_user,
        &state.config.vm_host_key_path,
    )
    .await?;
    let sftp = open_sftp_session(&mut ssh_handle).await?;
    let remote_path = stream_chat_attachment(&mut multipart, &sftp).await?;
    let remote_path_str = remote_path
        .to_str()
        .context("remote path is not valid UTF-8")?;
    Ok(Json(serde_json::json!({"path": remote_path_str})).into_response())
}

async fn stream_chat_attachment(multipart: &mut Multipart, sftp: &SftpSession) -> Result<PathBuf> {
    while let Some(field) = multipart
        .next_field()
        .await
        .context("failed to read multipart field")?
    {
        if field.name().context("multipart field missing name")? == "file" {
            let filename = field
                .file_name()
                .context("file upload missing filename")?
                .to_owned();
            let remote_path = build_chat_upload_path(&filename)?;
            let real_path = PathBuf::from(
                timeout(
                    Duration::from_secs(SFTP_OP_TIMEOUT_SECS),
                    sftp.canonicalize(
                        remote_path
                            .parent()
                            .context("chat upload path has no parent")?
                            .to_string_lossy()
                            .into_owned(),
                    ),
                )
                .await
                .context("canonicalize timed out")?
                .context("failed to resolve chat upload dir")?,
            )
            .join(
                remote_path
                    .file_name()
                    .context("chat upload path has no filename")?,
            );
            let chat_upload_dir = PathBuf::from("/tmp");
            validate_within_dir(&real_path, &chat_upload_dir)?;
            let mut reader = StreamReader::new(field.map_err(IoError::other));
            write_chat_file_via_sftp(sftp, &real_path, &mut reader).await?;
            return Ok(real_path);
        }
    }
    Err(anyhow!("missing 'file' field"))
}

fn build_chat_upload_path(filename: &str) -> Result<PathBuf> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock is before Unix epoch")?
        .as_millis();
    let safe_name = sanitize_filename::sanitize(filename);
    Ok(PathBuf::from("/tmp").join(format!("{ts}_{safe_name}")))
}

async fn write_chat_file_via_sftp(
    sftp: &SftpSession,
    path: &Path,
    reader: &mut (impl AsyncRead + Unpin),
) -> Result<()> {
    let path_str = path
        .to_str()
        .context("chat upload path is not valid UTF-8")?;
    let mut file = timeout(
        Duration::from_secs(SFTP_OP_TIMEOUT_SECS),
        sftp.create(path_str),
    )
    .await
    .context("sftp create timed out")?
    .map_err(|_| anyhow!("sftp create failed"))?;
    timeout(
        Duration::from_secs(SFTP_OP_TIMEOUT_SECS),
        tokio::io::copy(reader, &mut file),
    )
    .await
    .context("sftp write timed out")?
    .context("failed to write chat file via sftp")?;
    timeout(Duration::from_secs(SFTP_OP_TIMEOUT_SECS), file.shutdown())
        .await
        .context("sftp shutdown timed out")?
        .map_err(|_| anyhow!("sftp shutdown failed"))?;
    Ok(())
}
