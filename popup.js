const DEFAULTS = {
  enabled: true,
  widthPercent: 80,
  centerTable: true,
  smartTableCols: true,
  autoHideInput: true,
  autoHideSidebar: true
};

const enableToggle = document.getElementById('enableToggle');
const centerTableToggle = document.getElementById('centerTableToggle');
const smartTableColsToggle = document.getElementById('smartTableColsToggle');
const autoHideInputToggle = document.getElementById('autoHideInputToggle');
const autoHideSidebarToggle = document.getElementById('autoHideSidebarToggle');
const controlCard = document.getElementById('controlCard');
const widthRange = document.getElementById('widthRange');
const widthValue = document.getElementById('widthValue');
const resetBtn = document.getElementById('resetBtn');
const statusText = document.getElementById('statusText');
const presetButtons = Array.from(document.querySelectorAll('.preset-btn'));

function clampWidth(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULTS.widthPercent;
  return Math.min(100, Math.max(40, Math.round(num)));
}

function getCurrentFormState() {
  return {
    enabled: enableToggle.checked,
    widthPercent: clampWidth(widthRange.value),
    centerTable: centerTableToggle.checked,
    smartTableCols: smartTableColsToggle.checked,
    autoHideInput: autoHideInputToggle.checked,
    autoHideSidebar: autoHideSidebarToggle.checked
  };
}

function render(state, extraHint) {
  const enabled = Boolean(state.enabled);
  const widthPercent = clampWidth(state.widthPercent);
  const centerTable =
    state.centerTable !== undefined ? Boolean(state.centerTable) : DEFAULTS.centerTable;
  const smartTableCols =
    state.smartTableCols !== undefined ? Boolean(state.smartTableCols) : DEFAULTS.smartTableCols;
  const autoHideInput =
    state.autoHideInput !== undefined ? Boolean(state.autoHideInput) : DEFAULTS.autoHideInput;
  const autoHideSidebar =
    state.autoHideSidebar !== undefined ? Boolean(state.autoHideSidebar) : DEFAULTS.autoHideSidebar;

  enableToggle.checked = enabled;
  centerTableToggle.checked = centerTable;
  smartTableColsToggle.checked = smartTableCols;
  autoHideInputToggle.checked = autoHideInput;
  autoHideSidebarToggle.checked = autoHideSidebar;
  widthRange.value = String(widthPercent);
  widthValue.textContent = `${widthPercent}%`;
  controlCard.classList.toggle('disabled', !enabled);

  if (extraHint) {
    statusText.textContent = extraHint;
  } else {
    statusText.textContent = enabled
      ? `已实时生效（宽屏宽度 ${widthPercent}%）`
      : '宽屏模式已关闭（恢复 Gemini 默认宽度）';
  }

  presetButtons.forEach((btn) => {
    const val = Number(btn.dataset.width);
    btn.classList.toggle('active', val === widthPercent);
  });
}

async function pushToActiveGeminiTab(state) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url || !tab.url.startsWith('https://gemini.google.com/')) {
      render(state, '请切换到 gemini.google.com 标签页查看效果');
      return;
    }

    const sendApply = () =>
      new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: 'GWC_APPLY',
            enabled: state.enabled,
            widthPercent: state.widthPercent,
            centerTable: state.centerTable,
            smartTableCols: state.smartTableCols,
            autoHideInput: state.autoHideInput,
            autoHideSidebar: state.autoHideSidebar
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              resolve(null);
            } else {
              resolve(resp || null);
            }
          }
        );
      });

    let resp = await sendApply();

    if (!resp) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      resp = await sendApply();
    }

    if (resp && resp.ok) {
      render(
        state,
        state.enabled
          ? `已实时生效（纯 CSS · 宽度 ${state.widthPercent}%）`
          : '宽屏模式已关闭（已恢复默认宽度）'
      );
    }
  } catch (_) {}
}

function updateAndSave(nextState) {
  const normalized = {
    enabled: Boolean(nextState.enabled),
    widthPercent: clampWidth(nextState.widthPercent),
    centerTable:
      nextState.centerTable !== undefined ? Boolean(nextState.centerTable) : DEFAULTS.centerTable,
    smartTableCols:
      nextState.smartTableCols !== undefined
        ? Boolean(nextState.smartTableCols)
        : DEFAULTS.smartTableCols,
    autoHideInput:
      nextState.autoHideInput !== undefined
        ? Boolean(nextState.autoHideInput)
        : DEFAULTS.autoHideInput,
    autoHideSidebar:
      nextState.autoHideSidebar !== undefined
        ? Boolean(nextState.autoHideSidebar)
        : DEFAULTS.autoHideSidebar
  };
  render(normalized);
  chrome.storage.local.set(normalized);
  pushToActiveGeminiTab(normalized);
}

enableToggle.addEventListener('change', () => {
  updateAndSave(getCurrentFormState());
});

centerTableToggle.addEventListener('change', () => {
  updateAndSave(getCurrentFormState());
});

smartTableColsToggle.addEventListener('change', () => {
  updateAndSave(getCurrentFormState());
});

autoHideInputToggle.addEventListener('change', () => {
  updateAndSave(getCurrentFormState());
});

autoHideSidebarToggle.addEventListener('change', () => {
  updateAndSave(getCurrentFormState());
});

widthRange.addEventListener('input', () => {
  updateAndSave(getCurrentFormState());
});

presetButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    updateAndSave({
      ...getCurrentFormState(),
      enabled: true,
      widthPercent: clampWidth(btn.dataset.width)
    });
  });
});

resetBtn.addEventListener('click', () => {
  updateAndSave(DEFAULTS);
});

chrome.storage.local.get(DEFAULTS, (items) => {
  const state = {
    enabled: Boolean(items.enabled),
    widthPercent: clampWidth(items.widthPercent),
    centerTable:
      items.centerTable !== undefined ? Boolean(items.centerTable) : DEFAULTS.centerTable,
    smartTableCols:
      items.smartTableCols !== undefined ? Boolean(items.smartTableCols) : DEFAULTS.smartTableCols,
    autoHideInput:
      items.autoHideInput !== undefined ? Boolean(items.autoHideInput) : DEFAULTS.autoHideInput,
    autoHideSidebar:
      items.autoHideSidebar !== undefined
        ? Boolean(items.autoHideSidebar)
        : DEFAULTS.autoHideSidebar
  };
  render(state);
  pushToActiveGeminiTab(state);
});
