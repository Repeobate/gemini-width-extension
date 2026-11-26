(() => {
  const INSTANCE_VERSION = '2.3.3';
  if (window.__GWC_INSTANCE_VERSION__ === INSTANCE_VERSION) return;
  window.__GWC_INSTANCE_VERSION__ = INSTANCE_VERSION;

  const STYLE_ID = 'gemini-width-controller-style';
  const INPUT_TRIGGER_ID = 'gwc-input-trigger';
  const SIDEBAR_TRIGGER_ID = 'gwc-sidebar-trigger';
  const INPUT_OPEN_CLASS = 'gwc-input-open';
  const SIDEBAR_OPEN_CLASS = 'gwc-sidebar-open';

  const DEFAULTS = {
    enabled: true,
    widthPercent: 80,
    centerTable: true,
    smartTableCols: true,
    autoHideInput: true,
    autoHideSidebar: true
  };

  let currentState = { ...DEFAULTS };
  let tableTimer = null;
  // 缓存已定型表格的列宽（key -> number[]），若流式输出后续段落时 Angular 重建了前面的 table DOM，可 0ms 同步还原避免跳动
  const tableWidthCache = new Map();
  // 记录每个正在流式生成的表格的最后变动时间，避免每吐几个字就重算列宽导致疯狂跳动
  const tableLastChange = new WeakMap();
  const tableLastSig = new WeakMap();
  let hideInputTimer = null;
  let hideSidebarTimer = null;
  let inputResizeObserver = null;
  let observedInputEl = null;

  function clampWidth(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return DEFAULTS.widthPercent;
    return Math.min(100, Math.max(40, Math.round(num)));
  }

  function buildCss(
    enabled,
    widthPercent,
    centerTable,
    smartTableCols,
    autoHideInput,
    autoHideSidebar
  ) {
    const w = clampWidth(widthPercent);
    let css = `:root { --gwc-width: min(${w}%, calc(100% - 24px)); }\n`;

    if (enabled) {
      css += `
        /* 1. Gemini 回答区：.markdown-main-panel 本身全宽，由其直接子块各自按 --gwc-width 居中展开 */
        .markdown-main-panel > :not(img):not(svg):not(video):not(canvas),
        .markdown > :not(img):not(svg):not(video):not(canvas),
        structured-content-container > :has(table):not(:has(.markdown-main-panel)):not(:has(.markdown)),
        message-content > :has(table):not(:has(.markdown-main-panel)):not(:has(.markdown)) {
          width: var(--gwc-width) !important;
          max-width: var(--gwc-width) !important;
          margin-left: auto !important;
          margin-right: auto !important;
          box-sizing: border-box !important;
        }

        /* 回答区内部多层嵌套的标题、段落、列表、代码块铺满其父块 */
        .markdown-main-panel > * :is(
          h1, h2, h3, h4, h5, h6,
          p, ul, ol, pre, blockquote, hr,
          code-block, .code-block
        ),
        .markdown > * :is(
          h1, h2, h3, h4, h5, h6,
          p, ul, ol, pre, blockquote, hr,
          code-block, .code-block
        ) {
          max-width: 100% !important;
          box-sizing: border-box !important;
        }

        /* 2. 表格外层强制块级显示，内部包裹层严格 100% 铺满 */
        .markdown-main-panel > :has(table),
        .markdown > :has(table),
        structured-content-container > :has(table):not(:has(.markdown-main-panel)):not(:has(.markdown)),
        message-content > :has(table):not(:has(.markdown-main-panel)):not(:has(.markdown)) {
          display: block !important;
          width: var(--gwc-width) !important;
          max-width: var(--gwc-width) !important;
          margin-left: auto !important;
          margin-right: auto !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          box-sizing: border-box !important;
        }

        .markdown-main-panel > :has(table) :has(table),
        .markdown > :has(table) :has(table),
        structured-content-container > :has(table):not(:has(.markdown-main-panel)):not(:has(.markdown)) :has(table),
        message-content > :has(table):not(:has(.markdown-main-panel)):not(:has(.markdown)) :has(table) {
          display: block !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          box-sizing: border-box !important;
        }

        .markdown-main-panel table,
        .markdown table,
        table-block table,
        .table-block table {
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
        }

        /* 3. 用户提问区 */
        user-query {
          width: var(--gwc-width) !important;
          max-width: var(--gwc-width) !important;
          margin-left: auto !important;
          margin-right: auto !important;
          box-sizing: border-box !important;
        }

        user-query .user-query-container,
        user-query user-query-content {
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
        }

        user-query .user-query-bubble-with-background {
          max-width: min(80%, 960px) !important;
        }

        /* 4. 回答区顶部思考过程与底部操作栏 */
        model-thoughts,
        .thoughts-container,
        message-actions,
        .response-container-header,
        .response-container-footer,
        .response-footer {
          width: var(--gwc-width) !important;
          max-width: var(--gwc-width) !important;
          margin-left: auto !important;
          margin-right: auto !important;
          box-sizing: border-box !important;
        }

        model-thoughts,
        message-actions {
          display: block !important;
        }

        :is(.response-container-footer, .response-footer, .response-container-header, model-thoughts, .thoughts-container, message-actions)
          :is(message-actions, .response-container-footer, .response-footer, .thoughts-container, .actions-container-v2, .buttons-container-v2) {
          width: 100% !important;
          max-width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
          box-sizing: border-box !important;
        }

        /* 5. 底部输入框：仅在有对话内容的页面拓宽，空白首页保持原生居中 */
        body:has(user-query, model-response) .input-area-container {
          width: var(--gwc-width) !important;
          max-width: var(--gwc-width) !important;
          margin-left: auto !important;
          margin-right: auto !important;
          box-sizing: border-box !important;
        }

        body:has(user-query, model-response) .input-area-container input-area-v2,
        body:has(user-query, model-response) .input-area-container .input-area,
        body:has(user-query, model-response) .input-area-container .input-area-fieldset {
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
        }
      `;
    }

    if (smartTableCols) {
      css += `
        /* 6. 智能列宽模式 */
        table[data-gwc-smart-cols="1"] {
          table-layout: fixed !important;
          width: 100% !important;
        }

        table[data-gwc-smart-cols="1"] th,
        table[data-gwc-smart-cols="1"] td {
          overflow-wrap: break-word !important;
          white-space: normal !important;
        }
      `;
    }

    if (centerTable) {
      css += `
        /* 7. 表格文字水平与垂直居中 */
        .markdown-main-panel table th,
        .markdown-main-panel table td,
        .markdown table th,
        .markdown table td,
        table-block table th,
        table-block table td,
        .table-block table th,
        .table-block table td {
          text-align: center !important;
          vertical-align: middle !important;
        }

        .markdown-main-panel table th > *,
        .markdown-main-panel table td > *,
        .markdown table th > *,
        .markdown table td > *,
        table-block table th > *,
        table-block table td > *,
        .table-block table th > *,
        .table-block table td > * {
          text-align: center !important;
        }
      `;
    }

    if (autoHideInput) {
      css += `
        /* 8. 底部输入框自动隐藏（仅在已有对话页面生效） */
        #${INPUT_TRIGGER_ID} {
          display: none;
        }

        body:has(user-query, model-response) #${INPUT_TRIGGER_ID} {
          position: fixed;
          bottom: 0;
          left: 72px;
          right: 16px;
          height: 12px;
          z-index: 9990;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding-bottom: 3px;
          cursor: pointer;
          transition: opacity 0.18s ease;
        }

        #${INPUT_TRIGGER_ID} .gwc-trigger-pill {
          width: min(240px, 28%);
          height: 3.5px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.52);
          box-shadow: 0 0 6px rgba(15, 23, 42, 0.35);
          transition: background-color 0.18s ease, transform 0.18s ease;
        }

        #${INPUT_TRIGGER_ID}:hover .gwc-trigger-pill {
          background: rgba(96, 165, 250, 0.9);
          transform: scaleX(1.08);
        }

        body:has(user-query, model-response) input-container {
          transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.18s ease !important;
          will-change: transform, opacity;
        }

        html:not(.${INPUT_OPEN_CLASS}) body:has(user-query, model-response) input-container:not(:focus-within) {
          transform: translateY(calc(100% + 24px)) !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }

        html:not(.${INPUT_OPEN_CLASS}) body:has(user-query, model-response):not(:has(input-container:focus-within)) infinite-scroller.overlay-input-gradient {
          mask-image: none !important;
          -webkit-mask-image: none !important;
        }

        html.${INPUT_OPEN_CLASS} #${INPUT_TRIGGER_ID},
        body:has(input-container:focus-within) #${INPUT_TRIGGER_ID} {
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;
    } else {
      css += `
        #${INPUT_TRIGGER_ID} {
          display: none !important;
        }
      `;
    }

    if (autoHideSidebar) {
      css += `
        /* 9. 精准匹配 Gemini 原生缩略类 bard-sidenav.collapsed：缩略时自动隐藏，展开去除 .collapsed 后自动常驻 */
        #${SIDEBAR_TRIGGER_ID} {
          display: none;
        }

        body:has(bard-sidenav.collapsed) #${SIDEBAR_TRIGGER_ID} {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
          width: 12px;
          z-index: 9994;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          padding-left: 3px;
          cursor: pointer;
          transition: opacity 0.18s ease;
        }

        #${SIDEBAR_TRIGGER_ID} .gwc-sidebar-pill {
          width: 3.5px;
          height: min(180px, 22vh);
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.5);
          box-shadow: 0 0 6px rgba(15, 23, 42, 0.35);
          transition: background-color 0.18s ease, transform 0.18s ease;
        }

        #${SIDEBAR_TRIGGER_ID}:hover .gwc-sidebar-pill {
          background: rgba(96, 165, 250, 0.9);
          transform: scaleY(1.08);
        }

        /* 缩略态脱离 flex 占位（右侧对话区自动铺满 100%），平时滑出屏幕左外侧，移到左边缘平滑悬浮弹出 */
        bard-sidenav.collapsed {
          position: fixed !important;
          top: 0 !important;
          bottom: 0 !important;
          left: 0 !important;
          z-index: 9995 !important;
          transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.16s ease, box-shadow 0.2s ease !important;
          will-change: transform, opacity;
        }

        html:not(.${SIDEBAR_OPEN_CLASS}) bard-sidenav.collapsed {
          transform: translateX(calc(-100% - 12px)) !important;
          opacity: 0 !important;
          pointer-events: none !important;
          box-shadow: none !important;
        }

        html.${SIDEBAR_OPEN_CLASS} bard-sidenav.collapsed {
          transform: translateX(0) !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          box-shadow: 6px 0 24px rgba(0, 0, 0, 0.45) !important;
        }

        html.${SIDEBAR_OPEN_CLASS} #${SIDEBAR_TRIGGER_ID} {
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;
    } else {
      css += `
        #${SIDEBAR_TRIGGER_ID} {
          display: none !important;
        }
      `;
    }

    return css;
  }

  function ensureSidebarTrigger() {
    if (!document.body) return;
    let trigger = document.getElementById(SIDEBAR_TRIGGER_ID);
    if (!currentState.autoHideSidebar) {
      if (trigger) trigger.remove();
      document.documentElement.classList.remove(SIDEBAR_OPEN_CLASS);
      return;
    }

    if (!trigger) {
      trigger = document.createElement('div');
      trigger.id = SIDEBAR_TRIGGER_ID;
      trigger.title = '移到左边缘唤出侧边栏';
      const pill = document.createElement('div');
      pill.className = 'gwc-sidebar-pill';
      trigger.appendChild(pill);

      trigger.addEventListener('mouseenter', () => {
        openSidebar();
      });

      document.body.appendChild(trigger);
    }
  }

  function syncInputTriggerBounds() {
    const trigger = document.getElementById(INPUT_TRIGGER_ID);
    if (!trigger) return;
    const inputContainer = document.querySelector('input-container');
    if (!inputContainer) return;
    const rect = inputContainer.getBoundingClientRect();
    if (rect.width > 200) {
      trigger.style.left = `${Math.max(0, Math.round(rect.left))}px`;
      trigger.style.width = `${Math.round(rect.width)}px`;
      trigger.style.right = 'auto';
    }
  }

  function ensureInputTriggerBar() {
    if (!document.body) return;
    let trigger = document.getElementById(INPUT_TRIGGER_ID);
    if (!currentState.autoHideInput) {
      if (trigger) trigger.remove();
      document.documentElement.classList.remove(INPUT_OPEN_CLASS);
      return;
    }

    if (!trigger) {
      trigger = document.createElement('div');
      trigger.id = INPUT_TRIGGER_ID;
      trigger.title = '移到底部唤出 Gemini 输入框';
      const pill = document.createElement('div');
      pill.className = 'gwc-trigger-pill';
      trigger.appendChild(pill);

      trigger.addEventListener('mouseenter', () => {
        openInputBar();
      });

      document.body.appendChild(trigger);
    }

    const inputContainer = document.querySelector('input-container');
    if (inputContainer && inputContainer !== observedInputEl) {
      if (inputResizeObserver) inputResizeObserver.disconnect();
      inputResizeObserver = new ResizeObserver(() => {
        syncInputTriggerBounds();
      });
      inputResizeObserver.observe(inputContainer);
      observedInputEl = inputContainer;
    }

    syncInputTriggerBounds();
  }

  // 仅检测真正的交互式弹出菜单/下拉框/弹窗，忽略悬停气泡提示（tooltip）
  function isOverlayMenuOpen() {
    const menus = document.querySelectorAll(
      '.cdk-overlay-container [role="menu"], .cdk-overlay-container [role="listbox"], .cdk-overlay-container [role="dialog"], .cdk-overlay-container .mat-mdc-menu-panel, .cdk-overlay-container .mat-mdc-select-panel'
    );
    for (const m of menus) {
      if (m.getBoundingClientRect().height > 10) {
        return true;
      }
    }
    return false;
  }

  function isInputFocused() {
    const ic = document.querySelector('input-container');
    return Boolean(ic && document.activeElement && ic.contains(document.activeElement));
  }

  function openInputBar() {
    if (hideInputTimer) {
      clearTimeout(hideInputTimer);
      hideInputTimer = null;
    }
    document.documentElement.classList.add(INPUT_OPEN_CLASS);
  }

  function scheduleCloseInputBar() {
    if (hideInputTimer) clearTimeout(hideInputTimer);
    hideInputTimer = setTimeout(() => {
      hideInputTimer = null;
      if (isInputFocused() || isOverlayMenuOpen()) return;
      document.documentElement.classList.remove(INPUT_OPEN_CLASS);
    }, 220);
  }

  function openSidebar() {
    if (hideSidebarTimer) {
      clearTimeout(hideSidebarTimer);
      hideSidebarTimer = null;
    }
    document.documentElement.classList.add(SIDEBAR_OPEN_CLASS);
  }

  function scheduleCloseSidebar() {
    if (hideSidebarTimer) clearTimeout(hideSidebarTimer);
    hideSidebarTimer = setTimeout(() => {
      hideSidebarTimer = null;
      if (isOverlayMenuOpen()) return;
      document.documentElement.classList.remove(SIDEBAR_OPEN_CLASS);
    }, 220);
  }

  function initAutoHideEvents() {
    window.addEventListener(
      'mousemove',
      (e) => {
        // --- 1. 左侧缩略栏（bard-sidenav.collapsed）自动弹出/收起 ---
        if (currentState.autoHideSidebar) {
          const collapsedSidebar = document.querySelector('bard-sidenav.collapsed');
          if (collapsedSidebar) {
            if (e.clientX <= 12) {
              openSidebar();
            } else if (document.documentElement.classList.contains(SIDEBAR_OPEN_CLASS)) {
              const sbWidth = Math.max(collapsedSidebar.offsetWidth || 52, 56);
              if (e.clientX <= sbWidth + 16) {
                openSidebar();
              } else {
                scheduleCloseSidebar();
              }
            }
          } else if (document.documentElement.classList.contains(SIDEBAR_OPEN_CLASS)) {
            // 已展开为完整侧边栏，清理临时悬浮态
            document.documentElement.classList.remove(SIDEBAR_OPEN_CLASS);
          }
        }

        // --- 2. 底部输入框自动弹出/收起 ---
        if (currentState.autoHideInput) {
          const ic = document.querySelector('input-container');
          if (!ic) return;

          const rect = ic.getBoundingClientRect();
          const inHorizontalBounds =
            rect.width > 100
              ? e.clientX >= rect.left && e.clientX <= rect.right
              : e.clientX >= 60;

          const touchingLeftEdge =
            currentState.autoHideSidebar &&
            Boolean(document.querySelector('bard-sidenav.collapsed')) &&
            e.clientX <= 68;

          if (!touchingLeftEdge && inHorizontalBounds && e.clientY >= window.innerHeight - 12) {
            openInputBar();
            return;
          }

          if (document.documentElement.classList.contains(INPUT_OPEN_CLASS)) {
            const boxHeight = Math.max(ic.offsetHeight || 0, 130);
            const restingTop = window.innerHeight - boxHeight - 16;
            const insideInputBox =
              e.clientX >= rect.left &&
              e.clientX <= rect.right &&
              e.clientY >= restingTop &&
              e.clientY <= window.innerHeight;

            if (insideInputBox) {
              openInputBar();
            } else {
              scheduleCloseInputBar();
            }
          }
        }
      },
      { passive: true }
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (!currentState.autoHideInput) return;
        if (e.key === 'Escape' && isInputFocused() && !isOverlayMenuOpen()) {
          if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
          }
          scheduleCloseInputBar();
        }
      },
      { capture: false }
    );

    window.addEventListener('resize', syncInputTriggerBounds, { passive: true });
  }

  function measureVisualLength(text) {
    if (!text) return 0;
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return 0;
    let total = 0;
    for (let i = 0; i < cleaned.length; i++) {
      const code = cleaned.charCodeAt(i);
      total += code > 0x2e7f ? 1.85 : 1;
    }
    return total;
  }

  function measureMaxTokenLength(text) {
    if (!text) return 0;
    const tokens = text.split(/[\s/,，。；;：:()（）]+/);
    let maxLen = 0;
    for (const tok of tokens) {
      if (tok.length > maxLen) maxLen = tok.length;
    }
    return Math.min(maxLen, 28);
  }

  function clearSmartColsForTable(table) {
    if (!table) return;
    const cg = table.querySelector(':scope > colgroup[data-gwc-colgroup="1"]');
    if (cg) cg.remove();
    delete table.dataset.gwcSmartCols;
    delete table.dataset.gwcColSig;
  }

  function clearAllSmartCols() {
    const tables = document.querySelectorAll('table[data-gwc-smart-cols="1"]');
    for (const table of tables) {
      clearSmartColsForTable(table);
    }
  }

  function computeBalancedColumnWidths(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return null;

    let colCount = 0;
    for (const row of rows) {
      const cells = Array.from(row.children).filter(
        (c) => c.tagName === 'TH' || c.tagName === 'TD'
      );
      if (cells.length === 0) continue;
      for (const cell of cells) {
        const cs = Number(cell.getAttribute('colspan') || 1);
        const rs = Number(cell.getAttribute('rowspan') || 1);
        if (cs > 1 || rs > 1) return null;
      }
      if (colCount === 0) colCount = cells.length;
      else if (cells.length !== colCount) return null;
    }

    if (colCount < 2 || colCount > 10) return null;

    const sumLens = new Array(colCount).fill(0);
    const maxLens = new Array(colCount).fill(0);
    const maxTokens = new Array(colCount).fill(0);
    const counts = new Array(colCount).fill(0);

    for (const row of rows) {
      const cells = Array.from(row.children).filter(
        (c) => c.tagName === 'TH' || c.tagName === 'TD'
      );
      if (cells.length !== colCount) continue;
      const isHeader = cells[0].tagName === 'TH';
      for (let c = 0; c < colCount; c++) {
        const text = cells[c].textContent || '';
        const vLen = measureVisualLength(text);
        const tokLen = measureMaxTokenLength(text);
        const weight = isHeader ? 0.5 : 1;
        sumLens[c] += vLen * weight;
        counts[c] += weight;
        if (vLen > maxLens[c]) maxLens[c] = vLen;
        if (tokLen > maxTokens[c]) maxTokens[c] = tokLen;
      }
    }

    const weights = new Array(colCount);
    for (let c = 0; c < colCount; c++) {
      const avg = counts[c] > 0 ? sumLens[c] / counts[c] : 4;
      const blended = Math.max(avg * 0.65 + maxLens[c] * 0.35, maxTokens[c] * 1.15, 5);
      weights[c] = Math.pow(blended, 0.78);
    }

    const minPct = Math.max(8, Math.min(13, Math.floor(42 / colCount)));
    const maxPct = colCount === 2 ? 76 : 66;

    let pcts = new Array(colCount).fill(0);
    const locked = new Array(colCount).fill(false);
    let remainingPct = 100;

    for (let iter = 0; iter < colCount + 1; iter++) {
      let freeWeightSum = 0;
      for (let c = 0; c < colCount; c++) {
        if (!locked[c]) freeWeightSum += weights[c];
      }
      if (freeWeightSum <= 0) break;

      let changed = false;
      for (let c = 0; c < colCount; c++) {
        if (locked[c]) continue;
        const p = (weights[c] / freeWeightSum) * remainingPct;
        if (p < minPct) {
          pcts[c] = minPct;
          locked[c] = true;
          remainingPct -= minPct;
          changed = true;
        } else if (p > maxPct) {
          pcts[c] = maxPct;
          locked[c] = true;
          remainingPct -= maxPct;
          changed = true;
        } else {
          pcts[c] = p;
        }
      }
      if (!changed) break;
    }

    const rounded = pcts.map((p) => Math.round(p * 10) / 10);
    const total = rounded.reduce((a, b) => a + b, 0);
    const diff = Math.round((100 - total) * 10) / 10;
    if (diff !== 0) {
      let maxIdx = 0;
      for (let c = 1; c < colCount; c++) {
        if (rounded[c] > rounded[maxIdx]) maxIdx = c;
      }
      rounded[maxIdx] = Math.round((rounded[maxIdx] + diff) * 10) / 10;
    }

    return rounded;
  }

  function getTableCacheKey(table) {
    const rows = table.rows;
    if (!rows || rows.length < 2) return '';
    const r0 = (rows[0].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const r1 = (rows[1].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return `${rows.length}|${rows[0].cells.length}|${r0}|${r1}`;
  }

  function isTableCompleted(table) {
    // 若表格所在块后面已经有后续正文/标题节点，说明该表格已完全生成完毕
    const block =
      table.closest('table-block, .table-block, .table-block-component') || table;
    let cur = block;
    while (cur && cur.parentElement) {
      const parent = cur.parentElement;
      if (
        parent.classList.contains('markdown-main-panel') ||
        parent.classList.contains('markdown') ||
        parent.tagName === 'STRUCTURED-CONTENT-CONTAINER'
      ) {
        return Boolean(cur.nextElementSibling);
      }
      cur = parent;
    }
    return false;
  }

  function writeColgroup(table, widths, sig) {
    let colgroup = table.querySelector(':scope > colgroup[data-gwc-colgroup="1"]');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      colgroup.dataset.gwcColgroup = '1';
      table.insertBefore(colgroup, table.firstChild);
    }

    while (colgroup.children.length > widths.length) {
      colgroup.lastElementChild.remove();
    }
    for (let i = 0; i < widths.length; i++) {
      let col = colgroup.children[i];
      if (!col) {
        col = document.createElement('col');
        colgroup.appendChild(col);
      }
      col.style.width = `${widths[i]}%`;
    }

    table.dataset.gwcSmartCols = '1';
    table.dataset.gwcColSig = sig;
  }

  function applySmartTableCols(forceNow = false) {
    if (!currentState.smartTableCols) {
      clearAllSmartCols();
      return;
    }

    const now = Date.now();
    const tables = document.querySelectorAll(
      '.markdown-main-panel table, .markdown table, table-block table, .table-block table'
    );

    let hasPendingStreamingTable = false;

    for (const table of tables) {
      const textLen = (table.textContent || '').length;
      const rowCount = table.rows ? table.rows.length : 0;
      const sig = `${rowCount}:${textLen}`;

      if (table.dataset.gwcColSig === sig && table.dataset.gwcSmartCols === '1') {
        continue;
      }

      // 优先命中缓存：如果后续输出导致 Angular 重建了已完成的表格，0ms 直接套用原列宽，绝不跳动
      const cacheKey = getTableCacheKey(table);
      if (cacheKey && tableWidthCache.has(cacheKey)) {
        writeColgroup(table, tableWidthCache.get(cacheKey), sig);
        continue;
      }

      // 判断表格是否还在流式生成中
      const completed = isTableCompleted(table);
      if (!forceNow && !completed) {
        const prevSig = tableLastSig.get(table);
        if (prevSig !== sig) {
          tableLastSig.set(table, sig);
          tableLastChange.set(table, now);
          hasPendingStreamingTable = true;
          continue;
        }
        const lastTs = tableLastChange.get(table) || 0;
        if (now - lastTs < 850) {
          hasPendingStreamingTable = true;
          continue;
        }
      }

      const widths = computeBalancedColumnWidths(table);
      if (!widths) {
        clearSmartColsForTable(table);
        continue;
      }

      writeColgroup(table, widths, sig);

      if (cacheKey) {
        if (tableWidthCache.size > 60) {
          const firstKey = tableWidthCache.keys().next().value;
          tableWidthCache.delete(firstKey);
        }
        tableWidthCache.set(cacheKey, widths);
      }
    }

    if (hasPendingStreamingTable) {
      scheduleSmartTableUpdate(900);
    }
  }

  function scheduleSmartTableUpdate(delay = 850) {
    if (!currentState.smartTableCols) return;
    if (tableTimer) clearTimeout(tableTimer);
    tableTimer = setTimeout(() => {
      tableTimer = null;
      applySmartTableCols(false);
    }, delay);
  }

  function applySettings(raw) {
    currentState = {
      enabled: Boolean(raw.enabled),
      widthPercent: clampWidth(raw.widthPercent),
      centerTable:
        raw.centerTable !== undefined ? Boolean(raw.centerTable) : DEFAULTS.centerTable,
      smartTableCols:
        raw.smartTableCols !== undefined ? Boolean(raw.smartTableCols) : DEFAULTS.smartTableCols,
      autoHideInput:
        raw.autoHideInput !== undefined ? Boolean(raw.autoHideInput) : DEFAULTS.autoHideInput,
      autoHideSidebar:
        raw.autoHideSidebar !== undefined
          ? Boolean(raw.autoHideSidebar)
          : DEFAULTS.autoHideSidebar
    };

    const {
      enabled,
      widthPercent,
      centerTable,
      smartTableCols,
      autoHideInput,
      autoHideSidebar
    } = currentState;

    let styleEl = document.getElementById(STYLE_ID);

    if (!enabled && !centerTable && !smartTableCols && !autoHideInput && !autoHideSidebar) {
      if (styleEl) styleEl.remove();
      clearAllSmartCols();
      ensureInputTriggerBar();
      ensureSidebarTrigger();
      return;
    }

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
    }

    styleEl.textContent = buildCss(
      enabled,
      widthPercent,
      centerTable,
      smartTableCols,
      autoHideInput,
      autoHideSidebar
    );
    const parent = document.head || document.documentElement;
    if (parent && parent.lastElementChild !== styleEl) {
      parent.appendChild(styleEl);
    }

    if (document.body) {
      applySmartTableCols(true);
      ensureSidebarTrigger();
      ensureInputTriggerBar();
    }
  }

  function loadAndApply() {
    chrome.storage.local.get(DEFAULTS, (items) => {
      if (chrome.runtime.lastError) return;
      applySettings(items);
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (
      !changes.enabled &&
      !changes.widthPercent &&
      !changes.centerTable &&
      !changes.smartTableCols &&
      !changes.autoHideInput &&
      !changes.autoHideSidebar
    ) {
      return;
    }
    loadAndApply();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'GWC_APPLY') return;
    applySettings({
      enabled: msg.enabled,
      widthPercent: msg.widthPercent,
      centerTable: msg.centerTable,
      smartTableCols: msg.smartTableCols,
      autoHideInput: msg.autoHideInput,
      autoHideSidebar: msg.autoHideSidebar
    });
    sendResponse({ ok: true });
  });

  loadAndApply();
  initAutoHideEvents();

  function initDomObserver() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', initDomObserver, { once: true });
      return;
    }
    applySettings(currentState);

    const observer = new MutationObserver((mutations) => {
      if (currentState.autoHideInput && (!observedInputEl || !observedInputEl.isConnected)) {
        ensureInputTriggerBar();
      }
      if (!currentState.smartTableCols) return;
      let needDeferredCheck = false;
      for (const m of mutations) {
        const t = m.target;
        if (t && t.nodeType === 1 && (t.tagName === 'TABLE' || t.closest('table'))) {
          needDeferredCheck = true;
        }
        if (m.addedNodes && m.addedNodes.length > 0) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            const addedTables =
              n.tagName === 'TABLE'
                ? [n]
                : n.querySelectorAll
                  ? Array.from(n.querySelectorAll('table'))
                  : [];
            if (addedTables.length > 0) {
              // 若是已缓存表格被 Angular 重建，绘制前 0ms 同步恢复列宽，彻底不跳动
              for (const tbl of addedTables) {
                const key = getTableCacheKey(tbl);
                if (key && tableWidthCache.has(key)) {
                  const sig = `${tbl.rows.length}:${(tbl.textContent || '').length}`;
                  writeColgroup(tbl, tableWidthCache.get(key), sig);
                } else {
                  needDeferredCheck = true;
                }
              }
            }
          }
        }
      }
      if (needDeferredCheck) {
        scheduleSmartTableUpdate(850);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  initDomObserver();
})();
