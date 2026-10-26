// Monaco-based code editor for test CODE questions (founder request 2026-10:
// interviews should feel like an IDE). Loaded as its own lazy chunk — MCQ /
// SWIPE / WRITTEN sessions never download the editor. Monaco is bundled
// LOCALLY (no CDN): candidates on an office LAN need no internet beyond the
// app itself. Only the core editor + TS workers are wired — highlighting and
// editing are the point, not language servers.

import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// NOTE on paths: monaco-editor's exports map exposes ESM files under
// `monaco-editor/<path-under-esm/vs>` — hence no "esm/vs" prefix here.
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

// Module side effect: configure workers + use the bundled monaco instance so
// @monaco-editor/react never fetches from a CDN.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    return label === 'javascript' || label === 'typescript' ? new tsWorker() : new editorWorker();
  },
};
loader.config({ monaco });

/** ProvaHR language enum → monaco language id (fallback: plain text). */
function monacoLanguage(language: string | undefined): string {
  switch (language) {
    case 'NODE':
      return 'javascript';
    case 'PYTHON':
      return 'python';
    case 'BASH':
      return 'shellfile';
    default:
      return 'plaintext';
  }
}

export default function CodeEditor({
  language,
  value,
  onChange,
  onRun,
  onLargePaste,
  onCursor,
}: {
  language: string | undefined;
  value: string;
  onChange: (text: string) => void;
  onRun: () => void;
  onLargePaste: (chars: number) => void;
  onCursor?: (line: number, column: number) => void;
}): JSX.Element {
  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={monacoLanguage(language)}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        wordWrap: 'on',
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 4,
        renderLineHighlight: 'line',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        padding: { top: 10, bottom: 10 },
      }}
      onMount={(editor, monacoInstance) => {
        // Ctrl/Cmd+Enter runs the code, IDE-style.
        editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, onRun);
        // LARGE_PASTE parity with the textarea formats: Monaco reports the
        // pasted range after the fact — measure it and report the signal.
        editor.onDidPaste((e) => {
          const model = editor.getModel();
          if (model === null) return;
          const pasted = model.getValueInRange(e.range);
          if (pasted.length > 0) onLargePaste(pasted.length);
        });
        // Status-bar feed: current cursor position (Ln, Col).
        if (onCursor !== undefined) {
          editor.onDidChangeCursorPosition((e) => onCursor(e.position.lineNumber, e.position.column));
        }
      }}
    />
  );
}
