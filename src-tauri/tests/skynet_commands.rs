use std::collections::HashMap;

use cc_switch_lib::{map_skynet_mcp_server_for_test, AppType, SkynetMcpServerPayload};

#[test]
fn maps_stdio_skynet_mcp_server_to_unified_server() {
    let mapped = map_skynet_mcp_server_for_test(
        SkynetMcpServerPayload {
            id: "mcp-1".to_string(),
            name: "log-mcp".to_string(),
            display_name: Some("Log MCP".to_string()),
            description: Some("Query logs".to_string()),
            kind: "stdio".to_string(),
            command: Some("node".to_string()),
            args: Some(vec!["server.js".to_string()]),
            env: Some(HashMap::from([(
                "LOG_LEVEL".to_string(),
                "info".to_string(),
            )])),
            cwd: Some("/tmp/project".to_string()),
            url: None,
            headers: None,
        },
        &AppType::Codex,
    )
    .expect("stdio payload maps");

    assert_eq!(mapped.id, "mcp-1");
    assert_eq!(mapped.name, "Log MCP");
    assert_eq!(mapped.description.as_deref(), Some("Query logs"));
    assert!(mapped.apps.codex);
    assert!(!mapped.apps.claude);
    assert_eq!(mapped.server["type"], "stdio");
    assert_eq!(mapped.server["command"], "node");
    assert_eq!(mapped.server["args"][0], "server.js");
    assert_eq!(mapped.server["env"]["LOG_LEVEL"], "info");
    assert_eq!(mapped.server["cwd"], "/tmp/project");
}

#[test]
fn maps_http_skynet_mcp_server_to_unified_server() {
    let mapped = map_skynet_mcp_server_for_test(
        SkynetMcpServerPayload {
            id: "http-1".to_string(),
            name: "remote-mcp".to_string(),
            display_name: None,
            description: None,
            kind: "http".to_string(),
            command: None,
            args: None,
            env: None,
            cwd: None,
            url: Some("https://mcp.example.com".to_string()),
            headers: Some(HashMap::from([(
                "X-Team".to_string(),
                "platform".to_string(),
            )])),
        },
        &AppType::Claude,
    )
    .expect("http payload maps");

    assert_eq!(mapped.name, "remote-mcp");
    assert!(mapped.apps.claude);
    assert_eq!(mapped.server["type"], "http");
    assert_eq!(mapped.server["url"], "https://mcp.example.com");
    assert_eq!(mapped.server["headers"]["X-Team"], "platform");
}

#[test]
fn rejects_stdio_without_command() {
    let err = map_skynet_mcp_server_for_test(
        SkynetMcpServerPayload {
            id: "broken".to_string(),
            name: "broken".to_string(),
            display_name: None,
            description: None,
            kind: "stdio".to_string(),
            command: None,
            args: None,
            env: None,
            cwd: None,
            url: None,
            headers: None,
        },
        &AppType::Codex,
    )
    .expect_err("missing command should fail");

    assert!(err.contains("command"));
}

#[test]
fn rejects_remote_without_url() {
    let err = map_skynet_mcp_server_for_test(
        SkynetMcpServerPayload {
            id: "broken".to_string(),
            name: "broken".to_string(),
            display_name: None,
            description: None,
            kind: "sse".to_string(),
            command: None,
            args: None,
            env: None,
            cwd: None,
            url: None,
            headers: None,
        },
        &AppType::Claude,
    )
    .expect_err("missing url should fail");

    assert!(err.contains("url"));
}
