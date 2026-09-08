use crate::autofill::AutofillState;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "windows")]
use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
    KEYEVENTF_KEYUP, VK_ESCAPE, VK_LWIN, VK_S, VK_SHIFT,
};

#[cfg(target_os = "windows")]
fn key_input(vk: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(target_os = "windows")]
fn wait_for_region_capture() -> Result<bool, String> {
    // 隐藏主窗口后稍等桌面合成完成，确保截图里不会挡着 FallVault。
    thread::sleep(Duration::from_millis(220));

    let initial_sequence = unsafe { GetClipboardSequenceNumber() };
    // 清掉上一次 Escape 的瞬时状态，避免刚打开就被误判为取消。
    unsafe {
        GetAsyncKeyState(VK_ESCAPE as i32);
    }

    // 触发 Windows 自带 Win+Shift+S 矩形框选。截图结果由系统写入剪贴板，
    // 前端随后通过现有 clipboard-manager 插件读取 RGBA 像素并离线识别。
    let inputs = [
        key_input(VK_LWIN as u16, 0),
        key_input(VK_SHIFT as u16, 0),
        key_input(VK_S as u16, 0),
        key_input(VK_S as u16, KEYEVENTF_KEYUP),
        key_input(VK_SHIFT as u16, KEYEVENTF_KEYUP),
        key_input(VK_LWIN as u16, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent != inputs.len() as u32 {
        return Err("无法启动 Windows 区域截图".to_string());
    }

    let started_at = Instant::now();
    while started_at.elapsed() < Duration::from_secs(45) {
        thread::sleep(Duration::from_millis(60));
        let sequence = unsafe { GetClipboardSequenceNumber() };
        if sequence != initial_sequence {
            // 给截图工具一点时间完成剪贴板图像编码。
            thread::sleep(Duration::from_millis(180));
            return Ok(true);
        }

        let escape_state = unsafe { GetAsyncKeyState(VK_ESCAPE as i32) };
        if escape_state & 1 != 0 || escape_state < 0 {
            return Ok(false);
        }
    }

    Ok(false)
}

#[tauri::command]
pub async fn capture_screen_region(
    app: AppHandle,
    autofill_state: State<'_, Arc<AutofillState>>,
) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;

    // 防止模拟的 Win+Shift+S 被用户配置的自动填充单键误识别。
    let state = autofill_state.inner().clone();
    *state.busy.lock().unwrap() = true;
    if let Err(error) = window.hide() {
        *state.busy.lock().unwrap() = false;
        return Err(error.to_string());
    }

    #[cfg(target_os = "windows")]
    let capture_result = match tauri::async_runtime::spawn_blocking(wait_for_region_capture).await {
        Ok(result) => result,
        Err(error) => Err(error.to_string()),
    };

    #[cfg(not(target_os = "windows"))]
    let capture_result: Result<bool, String> = Err("区域截图目前仅支持 Windows".to_string());

    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    *state.busy.lock().unwrap() = false;
    capture_result
}
