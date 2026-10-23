import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import jsQR from 'jsqr';

interface ScreenCaptureFrame {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

interface CaptureSelection {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ScreenCaptureInfo {
  isEn: boolean;
  width: number;
  height: number;
}

type CaptureOutcome = 'decoded' | 'empty' | 'cancelled' | 'error';

export function ScreenCaptureOverlay() {
  const [captureInfo, setCaptureInfo] = useState<ScreenCaptureInfo | null>(null);
  const isEn = captureInfo?.isEn ?? false;
  const [captureFrame, setCaptureFrame] = useState<ScreenCaptureFrame | null>(null);
  const [captureSelection, setCaptureSelection] = useState<CaptureSelection | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureStartRef = useRef<{ x: number; y: number } | null>(null);
  const captureFrameRef = useRef<ScreenCaptureFrame | null>(null);
  const finishingRef = useRef(false);

  const releaseCaptureMemory = () => {
    captureFrameRef.current?.rgba.fill(0);
    captureFrameRef.current = null;
    const canvas = captureCanvasRef.current;
    if (canvas) {
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1;
      canvas.height = 1;
    }
    captureStartRef.current = null;
    setCaptureSelection(null);
    setCaptureFrame(null);
  };

  const finishCapture = async (outcome: CaptureOutcome, value: string | null = null) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    releaseCaptureMemory();
    try {
      await invoke('finish_screen_capture', { outcome, value });
    } catch (error) {
      console.error('Failed to close screen capture overlay:', error);
    }
  };

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const info = await invoke<ScreenCaptureInfo>('get_screen_capture_info');
        if (!info.width || !info.height) throw new Error('invalid screen capture dimensions');
        if (disposed) return;
        setCaptureInfo(info);

        const response = await invoke<unknown>('capture_screen_region');
        const bytes = response instanceof ArrayBuffer
          ? new Uint8Array(response)
          : ArrayBuffer.isView(response)
            ? new Uint8Array(response.buffer, response.byteOffset, response.byteLength)
            : Array.isArray(response)
              ? new Uint8Array(response)
              : null;
        if (!bytes || bytes.byteLength < 8) throw new Error('invalid in-memory screenshot');

        const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const width = header.getUint32(0, true);
        const height = header.getUint32(4, true);
        const expectedLength = width * height * 4;
        if (!width || !height || expectedLength !== bytes.byteLength - 8) {
          throw new Error('invalid in-memory screenshot dimensions');
        }

        const rgba = new Uint8ClampedArray(expectedLength);
        rgba.set(bytes.subarray(8));
        bytes.fill(0);
        if (disposed) {
          rgba.fill(0);
          return;
        }

        const frame = { width, height, rgba };
        captureFrameRef.current = frame;
        setCaptureFrame(frame);
      } catch (error) {
        console.error('Unable to prepare screen capture:', error);
        if (!disposed) await finishCapture('error');
      }
    })();

    return () => {
      disposed = true;
      releaseCaptureMemory();
    };
  }, []);

  useEffect(() => {
    const canvas = captureCanvasRef.current;
    if (!captureFrame || !canvas) return;
    canvas.width = captureFrame.width;
    canvas.height = captureFrame.height;
    const context = canvas.getContext('2d');
    if (!context) {
      void finishCapture('error');
      return;
    }
    context.putImageData(
      new ImageData(captureFrame.rgba, captureFrame.width, captureFrame.height),
      0,
      0,
    );

    // This dedicated window is still hidden. Show it only after the screenshot
    // and selection UI have been committed, so no application frame can flash.
    void invoke('show_screen_capture').catch((error) => {
      console.error('Failed to show screen capture overlay:', error);
      void finishCapture('error');
    });
  }, [captureFrame]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void finishCapture('cancelled');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const capturePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!captureFrame || event.button !== 0) return;
    const point = capturePoint(event);
    setHint(null);
    captureStartRef.current = { x: point.x, y: point.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    setCaptureSelection({ left: point.x, top: point.y, width: 0, height: 0 });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = captureStartRef.current;
    if (!start) return;
    const point = capturePoint(event);
    setCaptureSelection({
      left: Math.min(start.x, point.x),
      top: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  };

  const handlePointerUp = async (event: ReactPointerEvent<HTMLDivElement>) => {
    const frame = captureFrameRef.current;
    const start = captureStartRef.current;
    if (!frame || !start) return;
    const point = capturePoint(event);
    captureStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const selection = {
      left: Math.min(start.x, point.x),
      top: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    };
    if (selection.width < 12 || selection.height < 12) {
      setCaptureSelection(null);
      setHint(isEn ? 'Drag a larger area around the QR code' : '请拖动框选完整的二维码区域');
      return;
    }

    const scaleX = frame.width / point.viewportWidth;
    const scaleY = frame.height / point.viewportHeight;
    const sourceX = Math.max(0, Math.round(selection.left * scaleX));
    const sourceY = Math.max(0, Math.round(selection.top * scaleY));
    const sourceWidth = Math.min(
      frame.width - sourceX,
      Math.max(1, Math.round(selection.width * scaleX)),
    );
    const sourceHeight = Math.min(
      frame.height - sourceY,
      Math.max(1, Math.round(selection.height * scaleY)),
    );
    const sourceCanvas = captureCanvasRef.current;
    let decoded: string | null = null;

    try {
      if (!sourceCanvas) throw new Error('capture canvas unavailable');
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = sourceWidth;
      cropCanvas.height = sourceHeight;
      const context = cropCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('capture crop unavailable');
      context.drawImage(
        sourceCanvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );
      const imageData = context.getImageData(0, 0, sourceWidth, sourceHeight);
      const pixels = new Uint8ClampedArray(imageData.data.length);
      pixels.set(imageData.data);
      decoded = jsQR(pixels, sourceWidth, sourceHeight, { inversionAttempts: 'attemptBoth' })?.data || null;
      pixels.fill(0);
      imageData.data.fill(0);
      context.clearRect(0, 0, sourceWidth, sourceHeight);
      cropCanvas.width = 1;
      cropCanvas.height = 1;
    } catch (error) {
      console.error('TOTP in-memory crop failed:', error);
    }

    await finishCapture(decoded ? 'decoded' : 'empty', decoded);
  };

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black">
      <canvas ref={captureCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {!captureSelection && <div className="pointer-events-none absolute inset-0 bg-black/35" />}
      {captureSelection && (
        <div
          className="pointer-events-none absolute border-2 border-white"
          style={{
            left: captureSelection.left,
            top: captureSelection.top,
            width: captureSelection.width,
            height: captureSelection.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.48)',
          }}
        />
      )}
      <div
        className="absolute inset-0 cursor-crosshair touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <div className="pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-xl border border-white/20 bg-black/70 px-4 py-2 text-center text-sm text-white shadow-xl">
        <div>{isEn ? 'Drag around the QR code to scan' : '拖动鼠标框选完整二维码'}</div>
        <div className="mt-0.5 text-[11px] text-white/65">
          {hint || (isEn
            ? 'Processed in memory only · no screenshot file is created'
            : '仅在内存中处理，不会创建截图文件')}
        </div>
      </div>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => void finishCapture('cancelled')}
        className="absolute right-5 top-5 z-30 flex items-center gap-1.5 rounded-xl border border-white/20 bg-black/70 px-3 py-2 text-sm text-white hover:bg-black/85"
      >
        <X size={16} /> {isEn ? 'Cancel' : '取消'}
      </button>
    </div>
  );
}
