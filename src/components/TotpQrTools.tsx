import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, Loader2, QrCode, ScanLine, ShieldAlert, Upload, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Image as TauriImage } from '@tauri-apps/api/image';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import jsQR from 'jsqr';
import { QRCodeCanvas } from 'qrcode.react';
import { useToastStore } from '@/stores/toastStore';
import { startWindowDragFromBackdrop } from '@/lib/windowDrag';

interface TotpQrToolsProps {
  isEn: boolean;
  onDetected?: (value: string) => boolean;
  shareValue: string;
  shareLabel: string;
  shareOnly?: boolean;
}

type BusyMode = 'screen' | 'upload' | null;

interface ScreenCaptureResult {
  outcome: 'decoded' | 'empty' | 'cancelled' | 'error';
  value?: string | null;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  gif: 'image/gif',
};

export function TotpQrTools({ isEn, onDetected, shareValue, shareLabel, shareOnly = false }: TotpQrToolsProps) {
  const { addToast } = useToastStore();
  const [busy, setBusy] = useState<BusyMode>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState<'copy' | 'save' | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shareCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureUnlistenRef = useRef<null | (() => void)>(null);
  const captureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const decodeSource = (source: CanvasImageSource, sourceWidth: number, sourceHeight: number): string | null => {
    if (!sourceWidth || !sourceHeight) return null;

    // 限制超大图片的解码尺寸，避免 4K/8K 图片阻塞界面；常见二维码仍保留足够像素。
    const scale = Math.min(1, 2600 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = canvasRef.current || document.createElement('canvas');
    canvasRef.current = canvas;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const decoded = jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' })?.data || null;
    imageData.data.fill(0);
    context.clearRect(0, 0, width, height);
    return decoded;
  };

  const decodeBlob = async (blob: Blob): Promise<string | null> => {
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(blob);
      try {
        return decodeSource(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = objectUrl;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('image decode failed'));
      });
      return decodeSource(image, image.naturalWidth, image.naturalHeight);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const acceptDecoded = (value: string): boolean => {
    const accepted = onDetected?.(value) || false;
    if (accepted) {
      addToast(isEn ? '2FA QR code recognized' : '已识别 2FA 二维码', 'success');
    }
    return accepted;
  };

  const showDecodeResult = (decoded: string | null, emptyMessage: string) => {
    if (!decoded) {
      addToast(emptyMessage, 'warning');
    } else if (!acceptDecoded(decoded)) {
      addToast(isEn ? 'The QR code is not a valid 2FA key or link' : '二维码不是有效的 2FA 密钥或链接', 'warning');
    }
  };

  useEffect(() => {
    return () => {
      captureUnlistenRef.current?.();
      captureUnlistenRef.current = null;
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
      captureTimeoutRef.current = null;
    };
  }, []);

  const handleUpload = async () => {
    if (busy) return;
    const file = await open({
      multiple: false,
      filters: [{ name: isEn ? 'QR code images' : '二维码图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
    });
    if (!file || typeof file !== 'string') return;

    setBusy('upload');
    try {
      const bytes = await readFile(file);
      const extension = file.split('.').pop()?.toLowerCase() || 'png';
      const buffer = new Uint8Array(bytes).buffer;
      const decoded = await decodeBlob(new Blob([buffer], { type: IMAGE_MIME[extension] || 'image/png' }));
      showDecodeResult(decoded, isEn ? 'No QR code found in the image' : '图片中未识别到二维码');
    } catch (error) {
      console.error('TOTP QR image scan failed:', error);
      addToast(isEn ? 'Unable to read this image' : '图片读取或识别失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleScreenCapture = async () => {
    if (busy) return;
    setBusy('screen');
    try {
      captureUnlistenRef.current?.();
      captureUnlistenRef.current = await listen<ScreenCaptureResult>(
        'fallvault:screen-capture-result',
        ({ payload }) => {
          captureUnlistenRef.current?.();
          captureUnlistenRef.current = null;
          if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
          captureTimeoutRef.current = null;
          setBusy(null);

          if (payload.outcome === 'decoded') {
            showDecodeResult(
              payload.value || null,
              isEn ? 'No QR code found in the selected area' : '框选区域中未识别到二维码',
            );
          } else if (payload.outcome === 'empty') {
            showDecodeResult(
              null,
              isEn ? 'No QR code found in the selected area' : '框选区域中未识别到二维码',
            );
          } else if (payload.outcome === 'error') {
            addToast(isEn ? 'Region capture failed' : '区域截图失败，请重试', 'error');
          }
        },
      );

      // 使用独立的无边框置顶窗口承载框选层，主窗口不会再切换全屏尺寸。
      await invoke('open_screen_capture', { isEn });
      captureTimeoutRef.current = setTimeout(() => {
        void invoke('finish_screen_capture', { outcome: 'error', value: null }).catch((error) => {
          console.error('Timed out waiting for screen capture:', error);
          captureUnlistenRef.current?.();
          captureUnlistenRef.current = null;
          setBusy(null);
          addToast(isEn ? 'The capture window did not open. Please try again.' : '截图窗口未能打开，请重试', 'error');
        });
      }, 12000);
    } catch (error) {
      console.error('TOTP region capture failed:', error);
      captureUnlistenRef.current?.();
      captureUnlistenRef.current = null;
      if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
      captureTimeoutRef.current = null;
      addToast(isEn ? 'Region capture failed' : '区域截图失败，请重试', 'error');
      setBusy(null);
    }
  };

  const handleCopyShareQr = async () => {
    const canvas = shareCanvasRef.current;
    if (!canvas || shareBusy) return;
    setShareBusy('copy');
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('QR canvas unavailable');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const image = await TauriImage.new(new Uint8Array(pixels), canvas.width, canvas.height);
      try {
        await writeImage(image);
      } finally {
        await image.close();
      }
      addToast(isEn ? 'QR code copied as an image' : '二维码图片已复制', 'success');
    } catch (error) {
      console.error('Copy TOTP QR failed:', error);
      addToast(isEn ? 'Unable to copy the QR code' : '二维码复制失败', 'error');
    } finally {
      setShareBusy(null);
    }
  };

  const handleSaveShareQr = async () => {
    const canvas = shareCanvasRef.current;
    if (!canvas || shareBusy) return;
    const safeLabel = (shareLabel || 'FallVault').replace(/[\\/:*?"<>|]/g, '_');
    const file = await save({
      defaultPath: `${safeLabel}-2FA-QR.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (!file) return;

    setShareBusy('save');
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG encode failed')), 'image/png');
      });
      await writeFile(file, new Uint8Array(await blob.arrayBuffer()));
      addToast(isEn ? 'QR code saved' : '二维码已保存', 'success');
    } catch (error) {
      console.error('Save TOTP QR failed:', error);
      addToast(isEn ? 'Unable to save the QR code' : '二维码保存失败', 'error');
    } finally {
      setShareBusy(null);
    }
  };

  const toolButtonClass = 'rune-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className={shareOnly ? 'contents' : 'mt-2 flex flex-wrap items-center gap-2'}>
      {!shareOnly && (
        <>
          <button
            type="button"
            onClick={handleScreenCapture}
            disabled={!!busy}
            className={toolButtonClass}
            title={isEn ? 'Drag to select a screen area' : '拖动鼠标框选屏幕区域'}
          >
            {busy === 'screen' ? <Loader2 size={13} className="animate-spin" /> : <ScanLine size={13} />}
            {isEn ? 'Capture area' : '截图识别'}
          </button>
          <button type="button" onClick={handleUpload} disabled={!!busy} className={toolButtonClass}>
            {busy === 'upload' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {isEn ? 'Upload image' : '上传图片'}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => setShareOpen(true)}
        disabled={!!busy || !shareValue}
        className={shareOnly
          ? 'p-1 text-[var(--moon-dim)] transition-colors hover:text-[var(--mint)] disabled:opacity-40'
          : toolButtonClass}
        title={shareValue ? (isEn ? 'Show a QR code for this 2FA key' : '显示当前 2FA 密钥的二维码') : (isEn ? 'Enter a valid 2FA key first' : '请先输入有效的 2FA 密钥')}
        aria-label={isEn ? 'Share 2FA QR code' : '分享 2FA 二维码'}
      >
        <QrCode size={13} />
        {!shareOnly && (isEn ? 'Share QR' : '分享二维码')}
      </button>
      {!shareOnly && (
        <span className="text-[10px] text-[var(--moon-faint)]">
            {isEn ? 'Drag to select · memory only · no files saved' : '拖动框选区域 · 仅内存识别 · 不保存截图'}
        </span>
      )}

      {shareOpen && shareValue && createPortal((
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onMouseDown={startWindowDragFromBackdrop} />
          <div
            className="relative z-10 w-full max-w-sm p-5"
            style={{
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              borderRadius: '18px',
              boxShadow: '0 0 60px rgba(0,0,0,0.55)',
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--moon)]">
                <QrCode size={17} style={{ color: 'var(--mint)' }} />
                {isEn ? 'Share 2FA QR code' : '分享 2FA 二维码'}
              </div>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="rounded-lg p-1.5 text-[var(--moon-faint)] hover:bg-white/5 hover:text-[var(--moon)]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mx-auto w-fit overflow-hidden rounded-xl bg-white p-2">
              <QRCodeCanvas
                ref={shareCanvasRef}
                value={shareValue}
                size={280}
                level="M"
                marginSize={4}
                bgColor="#FFFFFF"
                fgColor="#111111"
                title={isEn ? `2FA QR code for ${shareLabel}` : `${shareLabel} 的 2FA 二维码`}
              />
            </div>
            <div className="mt-3 text-center text-sm font-medium text-[var(--moon)]">{shareLabel}</div>
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-[rgba(212,176,112,0.25)] bg-[rgba(212,176,112,0.08)] p-3 text-[11px] text-[var(--moon-dim)]">
              <ShieldAlert size={15} className="mt-0.5 shrink-0 text-[#D4B070]" />
              <span>{isEn ? 'Anyone who scans this code can generate your verification codes. Share it only with trusted devices.' : '二维码包含完整的 2FA 密钥，扫码者可以生成验证码。请只分享给可信设备。'}</span>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={handleCopyShareQr} disabled={!!shareBusy} className={toolButtonClass}>
                {shareBusy === 'copy' ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                {isEn ? 'Copy image' : '复制图片'}
              </button>
              <button type="button" onClick={handleSaveShareQr} disabled={!!shareBusy} className={toolButtonClass}>
                {shareBusy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {isEn ? 'Save PNG' : '保存 PNG'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

    </div>
  );
}
