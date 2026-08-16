// @ts-nocheck
/**
 * 页面端 DOM 无障碍树遍历器。
 *
 * 源码以字符串形式保存：compilePageWalker / compileElementWalker 把它编译为
 * 可在浏览器页面中执行的函数；walkerApi() 在 Node 侧编译同一份源码供单元测试
 * 直接调用（见 test/walker.test.ts）。单一来源，避免双份实现漂移。
 *
 * 注意：必须保持纯 JavaScript（无类型注解、无 ESM 语法、无模板字符串插值），
 * 且不能依赖 esbuild 注入的运行时辅助函数。
 */
const WALKER_SOURCE = `
const INTERACTIVE_ROLES = {
  button: 1,
  link: 1,
  textbox: 1,
  searchbox: 1,
  combobox: 1,
  checkbox: 1,
  radio: 1,
  switch: 1,
  slider: 1,
  spinbutton: 1,
  menuitem: 1,
  tab: 1,
  treeitem: 1,
  summary: 1,
};

// 这些角色的名称只接受显式标注（aria-label / aria-labelledby / title），
// 不从文本内容推断，避免 nav/main 等容器节点携带整段噪音文本。
const NAME_FROM_TEXT_ROLES = {
  link: 1,
  button: 1,
  heading: 1,
  paragraph: 1,
  option: 1,
  summary: 1,
  listitem: 1,
  menuitem: 1,
  tab: 1,
  treeitem: 1,
};

function collapse(s) {
  return String(s).replace(/\\s+/g, ' ').trim();
}

function styleOf(el, styleFn) {
  return styleFn ? styleFn(el) : getComputedStyle(el);
}

function isHidden(el, styleFn) {
  if (!el || el.nodeType !== 1) return true;
  if (el.hidden) return true;
  if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
  const cs = styleOf(el, styleFn);
  return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
}

function computeRole(el) {
  const explicit = el.getAttribute && el.getAttribute('role');
  if (explicit) {
    const r = explicit.trim().toLowerCase();
    if (r) return r;
  }
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'a':
      return el.hasAttribute('href') ? 'link' : null;
    case 'button':
      return 'button';
    case 'summary':
      return 'summary';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'img': {
      const alt = el.getAttribute('alt');
      return alt != null && alt !== '' ? 'img' : null;
    }
    case 'input': {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      switch (t) {
        case 'checkbox':
          return 'checkbox';
        case 'radio':
          return 'radio';
        case 'range':
          return 'slider';
        case 'number':
          return 'spinbutton';
        case 'search':
          return 'searchbox';
        case 'password':
          return 'textbox';
        case 'button':
        case 'submit':
        case 'reset':
          return 'button';
        case 'hidden':
          return null;
        default:
          return 'textbox';
      }
    }
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'option':
      return 'option';
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'aside':
      return 'complementary';
    case 'header':
      return 'banner';
    case 'footer':
      return 'contentinfo';
    case 'form':
      return 'form';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'listitem';
    case 'table':
      return 'table';
    case 'tr':
      return 'row';
    case 'td':
      return 'cell';
    case 'th':
      return 'columnheader';
    case 'figure':
      return 'figure';
    case 'figcaption':
      return 'figcaption';
    case 'dialog':
      return 'dialog';
    case 'p':
      return 'paragraph';
    case 'section':
      return 'section';
    case 'article':
      return 'article';
    case 'details':
      return 'group';
    case 'blockquote':
      return 'blockquote';
    default:
      return null;
  }
}

function cssEscapeId(id) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(id);
  return String(id).replace(/["\\\\]/g, '\\\\$&');
}

function labelText(doc, el) {
  const id = el.id;
  if (id && doc && doc.querySelector) {
    const lab = doc.querySelector('label[for="' + cssEscapeId(id) + '"]');
    if (lab) return collapse(lab.innerText || lab.textContent || '');
  }
  if (el.closest) {
    const wrap = el.closest('label');
    if (wrap) return collapse(wrap.innerText || wrap.textContent || '');
  }
  return '';
}

function nodeName(el, role, docArg) {
  const doc = docArg || (typeof document !== 'undefined' ? document : null);
  // 1. aria-labelledby 优先
  const lb = el.getAttribute && el.getAttribute('aria-labelledby');
  if (lb) {
    const parts = lb
      .split(/\\s+/)
      .map(function (id) {
        return doc && doc.getElementById ? doc.getElementById(id) : null;
      })
      .map(function (n) {
        return n ? collapse(n.innerText || n.textContent || '') : '';
      })
      .filter(Boolean);
    if (parts.length) return collapse(parts.join(' ')).slice(0, 300);
  }
  // 2. aria-label
  const al = el.getAttribute && el.getAttribute('aria-label');
  if (al && al.trim()) return collapse(al).slice(0, 300);
  // 3. 标签相关标签
  const tag = el.tagName.toLowerCase();
  if (tag === 'img') return collapse(el.getAttribute('alt') || '').slice(0, 300);
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const fromLabel = labelText(doc, el);
    if (fromLabel) return fromLabel.slice(0, 300);
    const t = ((el.getAttribute && el.getAttribute('type')) || 'text').toLowerCase();
    if (tag === 'input' && (t === 'submit' || t === 'button' || t === 'reset')) {
      return collapse(el.getAttribute('value') || '').slice(0, 300);
    }
    return '';
  }
  // 4. title 属性
  const title = el.getAttribute && el.getAttribute('title');
  if (title && title.trim()) return collapse(title).slice(0, 300);
  // 5. 文本内容（仅限特定角色）
  if (!NAME_FROM_TEXT_ROLES[role]) return '';
  const txt = collapse(el.innerText || el.textContent || '');
  return txt.slice(0, 300);
}

function nodeValue(el, role) {
  function clampVal(s) {
    return collapse(s).slice(0, 160);
  }
  const tag = el.tagName.toLowerCase();
  if ((role === 'textbox' || role === 'searchbox' || role === 'spinbutton') && (tag === 'input' || tag === 'textarea')) {
    if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'password') return undefined;
    const v = el.value || '';
    return v ? clampVal(v) : undefined;
  }
  if (role === 'combobox' && tag === 'select') {
    const sel = el.selectedOptions && el.selectedOptions[0];
    if (sel) return clampVal(sel.textContent || sel.text || '');
    return undefined;
  }
  if (role === 'option') {
    const t = collapse(el.textContent || '');
    const v = el.getAttribute && el.getAttribute('value');
    if (v && collapse(v) !== t) return clampVal(v);
    return undefined;
  }
  if (role === 'slider') return String(el.value != null ? el.value : 0);
  return undefined;
}

function tag_is_select(el) {
  return el.tagName.toLowerCase() === 'select';
}

function nodeStates(el, role) {
  const s = {};
  if (role === 'checkbox' || role === 'radio' || role === 'switch') {
    s.checked = el.checked === true || (el.getAttribute && el.getAttribute('aria-checked') === 'true');
  }
  if (el.disabled === true || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')) {
    s.disabled = true;
  }
  const hasExpanded = el.hasAttribute && el.hasAttribute('aria-expanded');
  if (role === 'combobox' || role === 'summary' || hasExpanded) {
    if (role === 'combobox' && tag_is_select(el) && !hasExpanded) {
      // 原生 select 无 aria-expanded 时不报告展开状态
      return s;
    }
    s.expanded = hasExpanded
      ? el.getAttribute('aria-expanded') === 'true'
      : (el.hasAttribute && el.hasAttribute('open')) || (role === 'summary' && el.parentElement && el.parentElement.hasAttribute('open'));
  }
  if (role === 'option' || role === 'tab' || role === 'menuitem') {
    s.selected = (el.hasAttribute && (el.hasAttribute('selected') || el.getAttribute('aria-selected') === 'true')) || false;
  }
  return s;
}

function buildPath(el) {
  // 返回 null（不分配 ref）的情形：
  // 1. 跨文档元素（iframe 内）：el.ownerDocument 不是顶层 document
  // 2. 父链断裂（shadow root 边界）：parentElement 链走不到 html
  // 注意：影子 DOM 内部元素本就不会被遍历到（el.children 不含 shadow 内容），
  // 因此对其不可见属设计限制，而非本函数职责。
  if (el.ownerDocument && (typeof document === 'undefined' || el.ownerDocument !== document)) return null;
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
    let nth = 1;
    let sib = cur.previousElementSibling;
    while (sib) {
      if (sib.tagName === cur.tagName) nth += 1;
      sib = sib.previousElementSibling;
    }
    parts.unshift(cur.tagName.toLowerCase() + ':nth-of-type(' + nth + ')');
    cur = cur.parentElement;
    // shadow 根处父链断裂：路径不完整，无法定位
    if (!cur && parts.length) return null;
  }
  parts.unshift('html');
  return parts.join(' > ');
}

function walkerMain(rootEl, opts) {
  const maxNodes = (opts && opts.maxNodes) || 600;
  const maxDepth = opts && opts.maxDepth ? opts.maxDepth : Infinity;
  const root = rootEl || (typeof document !== 'undefined' ? document.documentElement : null);
  const state = { nodes: 0, truncated: false };
  const tree = visit(root, 0, state);
  return { nodes: tree, truncated: state.truncated, maxNodes };

  function visit(el, depth, st) {
    const out = [];
    if (!el || el.nodeType !== 1 || st.truncated) return out;
    if (depth > maxDepth) return out;
    if (isHidden(el)) return out;
    const role = computeRole(el);
    if (!role) {
      // 无角色的纯包装元素：透传子节点
      for (let i = 0; i < el.children.length; i++) out.push.apply(out, visit(el.children[i], depth, st));
      return out;
    }
    if (st.nodes >= maxNodes) {
      st.truncated = true;
      return out;
    }
    st.nodes += 1;

    const node = { role };
    const name = nodeName(el, role);
    if (name) node.name = name;
    // 无名的 section/article 与纯包装 div 等价：透传子节点，避免结构噪音
    if ((role === 'section' || role === 'article') && !name) {
      for (let i = 0; i < el.children.length; i++) out.push.apply(out, visit(el.children[i], depth, st));
      return out;
    }
    if (role === 'heading') {
      const m = el.tagName.match(/^H([1-6])$/);
      node.level = m ? Number(m[1]) : Number(el.getAttribute('aria-level') || 1);
    }
    const states = nodeStates(el, role);
    if (states.checked !== undefined) node.checked = states.checked;
    if (states.disabled) node.disabled = true;
    if (states.expanded !== undefined) node.expanded = states.expanded;
    if (states.selected !== undefined) node.selected = states.selected;
    if (role === 'textbox' && el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'password') {
      node.password = true;
    }
    const value = nodeValue(el, role);
    if (value !== undefined) node.value = value;
    const ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph && ph.trim()) node.hint = collapse(ph).slice(0, 120);
    if (INTERACTIVE_ROLES[role]) {
      const path = buildPath(el);
      if (path) node.path = path;
    }

    const kids = [];
    for (let i = 0; i < el.children.length; i++) kids.push.apply(kids, visit(el.children[i], depth + 1, st));
    if (kids.length) node.children = kids;
    out.push(node);
    return out;
  }
}
`;

/**
 * 编译为 page.evaluate 可调用的遍历函数：fn(opts) => { nodes, truncated }。
 * 遍历 document.documentElement。
 */
export function compilePageWalker(): Function {
  return new Function('opts', WALKER_SOURCE + '\nreturn walkerMain(undefined, opts);');
}

/**
 * 编译为 locator.evaluate 可调用的遍历函数：fn(el, opts) => { nodes, truncated }。
 * 只遍历指定元素子树。
 */
export function compileElementWalker(): Function {
  return new Function('el', 'opts', WALKER_SOURCE + '\nreturn walkerMain(el, opts);');
}

/** 在 Node 侧编译同一份源码，返回各函数供单元测试调用。 */
export function walkerApi(): Record<string, (...args: unknown[]) => unknown> {
  return new Function(
    WALKER_SOURCE + '\nreturn { isHidden, computeRole, nodeName, nodeValue, nodeStates, buildPath, walkerMain };'
  )() as Record<string, (...args: unknown[]) => unknown>;
}
