// 下钻面包屑：顶部居中胶囊，展示钻栈路径（可点回跳）+ 上级/退出；
// 加载中与错误态就地显示。仅下钻模式出现。

export function createBreadcrumb({ overlayRoot, onUp, onExit, onCrumb, onDrillSelected }) {
  const root = document.createElement("div");
  root.className = "bcrumb hide";
  overlayRoot.appendChild(root);

  let state = { active: false, crumbs: [], loading: false, error: "", selected: "", canDrill: false };

  function render() {
    if (!state.active) {
      root.classList.add("hide");
      return;
    }
    root.classList.remove("hide");
    if (state.loading) {
      root.innerHTML = `<span class="blabel">加载中…</span>`;
      return;
    }
    if (state.error) {
      root.innerHTML = `<span class="blabel berr">${state.error}</span>`;
      return;
    }
    const crumbs = state.crumbs
      .map((crumb, i) => `<button class="bcrumb-item${i === state.crumbs.length - 1 ? " cur" : ""}" data-i="${i}" type="button">${crumb.name}</button>`)
      .join(`<span class="bsep">›</span>`);
    root.innerHTML = crumbs
      + (state.selected
        ? `<button class="bdrill" type="button"${state.canDrill ? "" : " disabled title=\"已是末级\""}>下钻 ${state.selected} ⤵</button>`
        : "")
      + `<button class="bup" type="button" title="上一级">‹ 上级</button>`
      + `<button class="bexit" type="button" title="退出下钻">×</button>`;
  }

  root.addEventListener("click", (event) => {
    const crumb = event.target.closest(".bcrumb-item");
    if (crumb) {
      const i = Number(crumb.dataset.i);
      // 点中间面包屑回跳到该级；点末级无操作
      if (i < state.crumbs.length - 1) onCrumb(i);
      return;
    }
    if (event.target.closest(".bdrill:not([disabled])")) onDrillSelected();
    else if (event.target.closest(".bup")) onUp();
    else if (event.target.closest(".bexit")) onExit();
  });

  return {
    update(next) {
      state = { ...state, ...next };
      render();
    },
    setLoading(loading) {
      state.loading = loading;
      render();
    },
    setError(error) {
      state.error = error;
      render();
      if (error) setTimeout(() => { state.error = ""; render(); }, 2500);
    },
  };
}
