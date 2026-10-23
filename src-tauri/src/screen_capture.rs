use crate::autofill::AutofillState;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use std::{thread, time::Duration};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
};

const CAPTURE_WINDOW_LABEL: &str = "screen-capture";
const CAPTURE_RESULT_EVENT: &str = "fallvault:screen-capture-result";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureInfo {
    pub is_en: bool,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Default)]
pub struct ScreenCaptureState {
    info: Mutex<Option<ScreenCaptureInfo>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenCaptureResult {
    outcome: String,
    value: Option<String>,
}

fn restore_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "windows")]
fn capture_monitor_rgba(x: i32, y: i32, width: u32, height: u32) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("屏幕尺寸无效".to_string());
    }

    let byte_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "屏幕截图尺寸过大".to_string())?;

    unsafe {
        let screen_dc = GetDC(0);
        if screen_dc == 0 {
            return Err("无法读取屏幕画面".to_string());
        }

        let memory_dc = CreateCompatibleDC(screen_dc);
        if memory_dc == 0 {
            ReleaseDC(0, screen_dc);
            return Err("无法创建内存截图".to_string());
        }

        let bitmap = CreateCompatibleBitmap(screen_dc, width as i32, height as i32);
        if bitmap == 0 {
            DeleteDC(memory_dc);
            ReleaseDC(0, screen_dc);
            return Err("无法创建截图位图".to_string());
        }

        let previous = SelectObject(memory_dc, bitmap);
        let copied = BitBlt(
            memory_dc,
            0,
            0,
            width as i32,
            height as i32,
            screen_dc,
            x,
            y,
            SRCCOPY | CAPTUREBLT,
        );
        SelectObject(memory_dc, previous);

        if copied == 0 {
            DeleteObject(bitmap);
            DeleteDC(memory_dc);
            ReleaseDC(0, screen_dc);
            return Err("无法复制屏幕画面".to_string());
        }

        let mut bitmap_info: BITMAPINFO = std::mem::zeroed();
        bitmap_info.bmiHeader.biSize = std::mem::size_of_val(&bitmap_info.bmiHeader) as u32;
        bitmap_info.bmiHeader.biWidth = width as i32;
        // 负高度要求 GDI 返回从上到下排列的像素，便于前端直接显示。
        bitmap_info.bmiHeader.biHeight = -(height as i32);
        bitmap_info.bmiHeader.biPlanes = 1;
        bitmap_info.bmiHeader.biBitCount = 32;
        bitmap_info.bmiHeader.biCompression = BI_RGB;

        let mut rgba = vec![0u8; byte_len];
        let scan_lines = GetDIBits(
            memory_dc,
            bitmap,
            0,
            height,
            rgba.as_mut_ptr().cast(),
            &mut bitmap_info,
            DIB_RGB_COLORS,
        );

        DeleteObject(bitmap);
        DeleteDC(memory_dc);
        ReleaseDC(0, screen_dc);

        if scan_lines != height as i32 {
            rgba.fill(0);
            return Err("无法读取截图像素".to_string());
        }

        // GDI 返回 BGRA；转换成浏览器 ImageData 使用的 RGBA，并强制设为不透明。
        for pixel in rgba.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }
        Ok(rgba)
    }
}

#[tauri::command]
pub async fn open_screen_capture(
    app: AppHandle,
    autofill_state: State<'_, Arc<AutofillState>>,
    capture_state: State<'_, Arc<ScreenCaptureState>>,
    is_en: bool,
) -> Result<(), String> {
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;

    let monitor = main_window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "找不到当前显示器".to_string())?;
    let position = *monitor.position();
    let size = *monitor.size();

    // 截图和框选期间屏蔽自动填充热键，避免用户拖动时误触发。
    let state = autofill_state.inner().clone();
    *state.busy.lock().unwrap() = true;
    if let Err(error) = main_window.hide() {
        *state.busy.lock().unwrap() = false;
        return Err(error.to_string());
    }

    if let Some(stale_window) = app.get_webview_window(CAPTURE_WINDOW_LABEL) {
        let _ = stale_window.destroy();
    }

    *capture_state.inner().info.lock().unwrap() = Some(ScreenCaptureInfo {
        is_en,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    });

    let capture_window = match WebviewWindowBuilder::new(
        &app,
        CAPTURE_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("FallVault Screen Capture")
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .build()
    {
        Ok(window) => window,
        Err(error) => {
            *capture_state.inner().info.lock().unwrap() = None;
            restore_main_window(&app);
            *state.busy.lock().unwrap() = false;
            return Err(error.to_string());
        }
    };

    if let Err(error) = capture_window.set_position(position) {
        let _ = capture_window.destroy();
        *capture_state.inner().info.lock().unwrap() = None;
        restore_main_window(&app);
        *state.busy.lock().unwrap() = false;
        return Err(error.to_string());
    }
    if let Err(error) = capture_window.set_size(size) {
        let _ = capture_window.destroy();
        *capture_state.inner().info.lock().unwrap() = None;
        restore_main_window(&app);
        *state.busy.lock().unwrap() = false;
        return Err(error.to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn get_screen_capture_info(
    capture_state: State<'_, Arc<ScreenCaptureState>>,
) -> Result<ScreenCaptureInfo, String> {
    capture_state
        .inner()
        .info
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "找不到截图会话".to_string())
}

#[tauri::command]
pub async fn capture_screen_region(
    capture_state: State<'_, Arc<ScreenCaptureState>>,
) -> Result<Response, String> {
    let info = capture_state
        .inner()
        .info
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "找不到截图会话".to_string())?;
    let (x, y, width, height) = (info.x, info.y, info.width, info.height);
    if width == 0 || height == 0 {
        return Err("屏幕尺寸无效".to_string());
    }

    #[cfg(target_os = "windows")]
    let capture_result = match tauri::async_runtime::spawn_blocking(move || {
        // 独立截图窗口仍保持隐藏；稍等桌面合成完成后直接读取当前显示器。
        thread::sleep(Duration::from_millis(80));
        capture_monitor_rgba(x, y, width, height)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(error.to_string()),
    };

    #[cfg(not(target_os = "windows"))]
    let capture_result: Result<Vec<u8>, String> = Err("区域截图目前仅支持 Windows".to_string());

    let mut rgba = capture_result?;

    // 使用原始 IPC 二进制响应：前 8 字节为宽高，其余为 RGBA。
    // 全程只在内存中传递，不调用系统截图工具，也不写入剪贴板或磁盘。
    let mut payload = Vec::with_capacity(8 + rgba.len());
    payload.extend_from_slice(&width.to_le_bytes());
    payload.extend_from_slice(&height.to_le_bytes());
    payload.extend_from_slice(&rgba);
    rgba.fill(0);
    Ok(Response::new(payload))
}

#[tauri::command]
pub fn show_screen_capture(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(CAPTURE_WINDOW_LABEL)
        .ok_or_else(|| "找不到截图窗口".to_string())?;

    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub fn finish_screen_capture(
    app: AppHandle,
    autofill_state: State<'_, Arc<AutofillState>>,
    capture_state: State<'_, Arc<ScreenCaptureState>>,
    outcome: String,
    value: Option<String>,
) -> Result<(), String> {
    let capture_window = app.get_webview_window(CAPTURE_WINDOW_LABEL);
    if let Some(window) = capture_window.as_ref() {
        let _ = window.hide();
    }
    restore_main_window(&app);
    *autofill_state.inner().busy.lock().unwrap() = false;
    *capture_state.inner().info.lock().unwrap() = None;
    let emit_result = app
        .emit_to(
            "main",
            CAPTURE_RESULT_EVENT,
            ScreenCaptureResult { outcome, value },
        )
        .map_err(|error| error.to_string());
    if let Some(window) = capture_window {
        let _ = window.destroy();
    }
    emit_result
}
