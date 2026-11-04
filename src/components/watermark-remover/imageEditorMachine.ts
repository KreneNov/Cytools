import type { ImageEditorState } from '../../types/watermarkRemover';

export type EditorEvent =
  | { type: 'IMAGE_LOADED' }
  | { type: 'MASK_CHANGED'; hasMask: boolean }
  | { type: 'INPAINT_STARTED' }
  | { type: 'INPAINT_SUCCEEDED' }
  | { type: 'INPAINT_FAILED' }
  | { type: 'RESET' };

/**
 * Deterministic finite state machine for the image watermark editor.
 * Events that are not valid for the current state are ignored (state unchanged).
 */
export function editorReducer(state: ImageEditorState, event: EditorEvent): ImageEditorState {
  if (event.type === 'IMAGE_LOADED' || event.type === 'RESET') {
    return 'IDLE';
  }

  switch (state) {
    case 'IDLE':
      if (event.type === 'MASK_CHANGED' && event.hasMask) return 'PAINTING';
      return state;
    case 'PAINTING':
      if (event.type === 'MASK_CHANGED' && !event.hasMask) return 'IDLE';
      if (event.type === 'INPAINT_STARTED') return 'PROCESSING';
      return state;
    case 'PROCESSING':
      if (event.type === 'INPAINT_SUCCEEDED') return 'DONE';
      if (event.type === 'INPAINT_FAILED') return 'PAINTING';
      return state;
    case 'DONE':
      if (event.type === 'MASK_CHANGED' && event.hasMask) return 'PAINTING';
      return state;
    default:
      return state;
  }
}

export interface EditorUiFlags {
  toolsEnabled: boolean;
  showHistoryControls: boolean;
  showInpaintButton: boolean;
  inpaintEnabled: boolean;
  showProcessing: boolean;
  showResultActions: boolean;
  canvasInteractive: boolean;
}

/**
 * Derives control visibility strictly from the FSM state (single source of truth).
 */
export function deriveEditorUi(state: ImageEditorState): EditorUiFlags {
  return {
    toolsEnabled: state !== 'PROCESSING',
    showHistoryControls: state === 'PAINTING',
    showInpaintButton: state === 'IDLE' || state === 'PAINTING',
    inpaintEnabled: state === 'PAINTING',
    showProcessing: state === 'PROCESSING',
    showResultActions: state === 'DONE',
    canvasInteractive: state !== 'PROCESSING',
  };
}
