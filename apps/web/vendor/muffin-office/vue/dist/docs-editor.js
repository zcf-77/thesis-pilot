import { FRAGMENT_SELECTOR as e, FragmentIndex as t, HighlightPainter as n, HighlightStore as r, canHighlightText as i, domRange as a, indexModel as o, inlineOffsets as s, isLabelledList as c, mapText as l, normalizeAnchor as u, offsetAt as d, paragraphText as f, resolveRanges as p, selectionFromParts as m, tableGrid as h } from "./docs-anchors.js";
import { C as g, S as _, a as v, b as y, c as b, f as x, g as S, h as C, i as w, m as T, n as ee, o as E, r as D, s as O, t as k, v as A, x as j, y as M } from "./chunks/docs-editor-BTo_F3eW.js";
import { Fragment as N, Teleport as te, computed as P, createBlock as F, createCommentVNode as I, createElementBlock as L, createElementVNode as R, createStaticVNode as z, createTextVNode as ne, createVNode as re, defineComponent as ie, h as B, mergeProps as V, nextTick as ae, normalizeClass as oe, normalizeStyle as H, onMounted as se, onUnmounted as ce, openBlock as U, reactive as le, ref as W, renderList as G, renderSlot as ue, shallowRef as de, toDisplayString as K, vModelSelect as fe, watch as pe, withDirectives as me, withModifiers as q } from "vue";
// packages/vue/src/font-runtime.ts
var J = (e) => e.trim().replace(/^['"]|['"]$/g, "").toLowerCase().replace(/[\s_-]+/g, ""), Y = /* @__PURE__ */ new Map();
function he(e) {
	return Y.get(J(e))?.[0];
}
// packages/vue/src/font-local-aliases.ts
var ge = [
	["FangSong_GB2312", "仿宋_GB2312"],
	["KaiTi_GB2312", "楷体_GB2312"],
	[
		"FZXiaoBiaoSong-B05S",
		"方正小标宋简体",
		"FZXBSJW--GB1-0"
	],
	["SimSun", "宋体"],
	["NSimSun", "新宋体"],
	["SimHei", "黑体"],
	["FangSong", "仿宋"],
	["KaiTi", "楷体"]
], _e = (e) => e.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
function ve(e) {
	return ge.find((t) => t.some((t) => _e(t) === _e(e))) ?? [e.trim().replace(/^['"]|['"]$/g, "")];
}
// packages/vue/src/fonts.ts
var ye = {
	fangsong: "MO Fangsong",
	kaiti: "MO Kaiti",
	heiti: "MO Heiti",
	songti: "MO Songti",
	title: "MO Title",
	serif: "MO Serif",
	sans: "MO Sans",
	calibri: "MO Calibri",
	inter: "MO Inter"
}, be = {};
function X(e, ...t) {
	for (let n of t) be[xe(n)] = e;
}
function xe(e) {
	return e.trim().replace(/^['"]|['"]$/g, "").toLowerCase().replace(/[\s_-]+/g, "");
}
X("fangsong", "仿宋_GB2312", "仿宋", "仿宋体", "FangSong", "FangSong_GB2312", "STFangsong", "华文仿宋"), X("fangsong", "Zhuque Fangsong (technical preview)", "朱雀仿宋", "朱雀仿宋（预览测试版）"), X("kaiti", "楷体_GB2312", "楷体", "KaiTi", "KaiTi_GB2312", "STKaiti", "华文楷体", "Kaiti SC"), X("kaiti", "LXGW WenKai", "霞鹜文楷"), X("heiti", "黑体", "SimHei", "微软雅黑", "Microsoft YaHei", "Microsoft YaHei UI", "等线", "DengXian"), X("heiti", "思源黑体", "Source Han Sans SC", "Source Han Sans CN", "Noto Sans CJK SC", "Noto Sans SC"), X("heiti", "PingFang SC", "苹方", "Heiti SC", "STHeiti", "HarmonyOS Sans SC", "Hiragino Sans GB"), X("songti", "宋体", "SimSun", "新宋体", "NSimSun", "Songti SC", "STSong", "华文宋体", "华文中宋", "STZhongsong"), X("songti", "思源宋体", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN"), X("title", "方正小标宋简体", "方正小标宋_GBK", "方正小标宋", "小标宋", "FZXiaoBiaoSong-B05S", "FZXiaoBiaoSong-B05"), X("title", "Noto Serif CJK SC Black", "Source Han Serif SC Heavy"), X("serif", "Times New Roman", "Times", "Liberation Serif", "Tinos", "Cambria", "Georgia"), X("sans", "Arial", "Helvetica", "Helvetica Neue", "Liberation Sans", "Arimo", "Segoe UI", "Verdana", "Tahoma"), X("calibri", "Calibri", "Carlito", "Calibri Light"), X("inter", "Inter", "Inter Variable");
var Se = [
	[/仿宋|fangsong/i, "fangsong"],
	[/楷|kai(ti)?\b|wenkai/i, "kaiti"],
	[/小标宋|标宋|biaosong/i, "title"],
	[/宋|明朝|song|serif\s*(cjk|sc|cn)/i, "songti"],
	[/黑|雅黑|圆|苹方|yahei|hei\b|heiti|sans\s*(cjk|sc|cn)|harmonyos|等线|dengxian/i, "heiti"]
], Ce = new Set([
	"宋体",
	"SimSun",
	"新宋体",
	"NSimSun",
	"黑体",
	"SimHei",
	"仿宋",
	"仿宋_GB2312",
	"仿宋体",
	"FangSong",
	"FangSong_GB2312",
	"楷体",
	"楷体_GB2312",
	"KaiTi",
	"KaiTi_GB2312"
].map(xe));
function we(e) {
	if (!e || !Ce.has(xe(e))) return;
	let t = Te(e);
	return t && t + " HW";
}
function Te(e) {
	if (!e) return;
	let t = be[xe(e)] ?? Se.find(([t]) => t.test(e))?.[1];
	return t ? ye[t] : void 0;
}
var Ee = /* @__PURE__ */ new Set([
	"serif",
	"sans-serif",
	"monospace",
	"cursive",
	"fantasy",
	"system-ui",
	"ui-monospace"
]);
function De(e) {
	return Ee.has(e) ? e : `"${e.replace(/["\\]/g, "")}"`;
}
function Oe(e, t = "serif", n, r) {
	let i = [], a = (e) => {
		e && !i.includes(e) && i.push(e);
	}, o = /* @__PURE__ */ new Set([
		ye.fangsong,
		ye.kaiti,
		ye.heiti,
		ye.songti,
		ye.title
	]), [s, c] = e;
	for (let [t, i] of e.entries()) i && (t === 0 && c && s && xe(ve(c)[0]) !== xe(ve(s)[0]) && o.has(Te(s) ?? "") ? (a(r?.get(xe(i))), a(he(i)?.cssLatinFamily), a(we(s))) : (a(n?.get(xe(i))), a(he(i)?.cssFamily), a(i.trim().replace(/^['"]|['"]$/g, "")), a(we(i)), a(Te(i) ?? i.trim().replace(/^['"]|['"]$/g, ""))));
	return t === "sans-serif" ? a(ye.heiti) : t === "serif" && a(ye.songti), a(t), i.map(De).join(", ");
}
// packages/vue/src/render.ts
function ke(e, t, n) {
	if (!e) return n;
	switch (e.kind) {
		case "rgb": return `#${e.value}`;
		case "theme": return t[e.value] ? `#${t[e.value]}` : n;
		default: return n;
	}
}
function Ae(e, t) {
	return e === "mono" ? Oe([t.mono, "ui-monospace"], "monospace") : Oe(e === "heading" ? [t.headingLatin, t.headingZh] : [t.bodyLatin, t.bodyZh], "sans-serif");
}
var je = [
	"零",
	"一",
	"二",
	"三",
	"四",
	"五",
	"六",
	"七",
	"八",
	"九"
];
function Me(e) {
	return e <= 0 ? String(e) : e < 10 ? je[e] : e < 20 ? `十${e % 10 ? je[e % 10] : ""}` : e < 100 ? `${je[Math.floor(e / 10)]}十${e % 10 ? je[e % 10] : ""}` : String(e);
}
function Ne(e) {
	let t = [
		[1e3, "m"],
		[900, "cm"],
		[500, "d"],
		[400, "cd"],
		[100, "c"],
		[90, "xc"],
		[50, "l"],
		[40, "xl"],
		[10, "x"],
		[9, "ix"],
		[5, "v"],
		[4, "iv"],
		[1, "i"]
	], n = "";
	for (let [r, i] of t) for (; e >= r;) n += i, e -= r;
	return n;
}
function Pe(e) {
	let t = "";
	for (; e > 0;) --e, t = String.fromCharCode(97 + e % 26) + t, e = Math.floor(e / 26);
	return t;
}
function Fe(e, t, n) {
	switch (e) {
		case "decimal": return `${t}.`;
		case "lower_alpha": return `${Pe(t)}.`;
		case "upper_alpha": return `${Pe(t).toUpperCase()}.`;
		case "lower_roman": return `${Ne(t)}.`;
		case "upper_roman": return `${Ne(t).toUpperCase()}.`;
		case "chinese_counting": return `${Me(t)}、`;
		case "decimal_enclosed_circle": return t >= 1 && t <= 20 ? String.fromCodePoint(9312 + t - 1) : `${t}.`;
		case "chinese_paren": return `（${Me(t)}）`;
		case "task": return n ? "☑" : "☐";
		default: return "•";
	}
}
// packages/vue/src/docs-pagination.ts
function Ie(e) {
	let t = [], n = typeof Intl.Segmenter == "function" ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : void 0;
	function r(e) {
		if (e.nodeType === Node.TEXT_NODE) {
			let r = e.textContent ?? "";
			if (n) for (let i of n.segment(r)) {
				if (t.length >= 5e4) break;
				t.push({
					node: e,
					offset: i.index + i.segment.length
				});
			}
			else {
				let n = 0;
				for (let i of r) n += i.length, t.push({
					node: e,
					offset: n
				});
			}
		} else if (e instanceof HTMLElement && ([
			"IMG",
			"BR",
			"HR"
		].includes(e.tagName) || e.dataset.docField)) {
			let n = e.parentNode;
			n && t.push({
				node: n,
				offset: Array.from(n.childNodes).indexOf(e) + 1
			});
		} else for (let n of Array.from(e.childNodes)) {
			if (t.length >= 5e4) break;
			r(n);
		}
	}
	for (let n of Array.from(e.childNodes)) {
		if (t.length >= 5e4) break;
		r(n);
	}
	return t;
}
function Le(e, t, n = !1) {
	let r = document.createRange();
	r.selectNodeContents(e), n ? r.setStart(t.node, t.offset) : r.setEnd(t.node, t.offset);
	let i = e.cloneNode(!1);
	return i.append(r.cloneContents()), n ? (i.style.marginTop = "0px", i.style.textIndent = "0px", i.dataset.previewContinuation = "true") : i.style.marginBottom = "0px", i;
}
var Re = (e) => [
	"P",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6"
].includes(e.tagName);
function ze(e, t) {
	t.append(e);
	let n = getComputedStyle(e), r = e.getBoundingClientRect().height, i = parseFloat(n.lineHeight) || parseFloat(n.fontSize) * 1.2;
	return e.remove(), {
		height: r,
		line: i
	};
}
function Be(e, t) {
	let n = e.map((e) => e.cloneNode(!0));
	t.append(...n);
	let r = n[n.length - 1], i = r.getBoundingClientRect(), a = getComputedStyle(r), o = parseFloat(a.lineHeight) || parseFloat(a.fontSize) * 1.2, s = i.top + (Re(r) ? Math.min(i.height, o * 2) : i.height) <= t.getBoundingClientRect().top + t.clientHeight + 1;
	for (let e of n) e.remove();
	return s;
}
function Ve(e, t, n) {
	let r = Ie(e);
	if (r.length < 2) return;
	let i = (n) => {
		let i = Le(e, r[n - 1]);
		t.append(i);
		let a = t.scrollHeight <= t.clientHeight + 1;
		return i.remove(), a;
	}, a = 1, o = r.length - 1, s = 0;
	if (n != null && n >= a && n <= o) {
		if (i(n)) {
			s = n, a = n + 1;
			for (let e = 1; a <= o; e *= 2) {
				let t = Math.min(o, n + e);
				if (!i(t)) {
					o = t - 1;
					break;
				}
				s = t, a = t + 1;
			}
		} else {
			o = n - 1;
			for (let e = 1; a <= o; e *= 2) {
				let t = Math.max(a, n - e);
				if (i(t)) {
					s = t, a = t + 1;
					break;
				}
				o = t - 1;
			}
		}
	}
	for (; a <= o;) {
		let e = Math.floor((a + o) / 2);
		i(e) ? (s = e, a = e + 1) : o = e - 1;
	}
	if (!s) return;
	let c = (e, t) => e && e.node.nodeType === Node.TEXT_NODE ? (e.node.textContent ?? "").charAt(e.offset + t) : "", l = /[\p{Script=Latin}\p{N}]/u;
	if (l.test(c(r[s - 1], -1)) && l.test(c(r[s - 1], 0))) {
		for (let e = s; e > Math.max(0, s - 24); e--) if (/\s/.test(c(r[e - 1], -1))) {
			s = e;
			break;
		}
	}
	let u = ze(e, t);
	if (e.dataset.docWidowControl !== "false" && u.height <= t.clientHeight + 1) {
		let n = (e) => Math.round(ze(e, t).height / u.line);
		if (n(Le(e, r[s - 1], !0)) < 2) {
			let t = 1, i = s, a = 0;
			for (; t <= i;) {
				let o = Math.floor((t + i) / 2);
				n(Le(e, r[o - 1], !0)) >= 2 ? (a = o, t = o + 1) : i = o - 1;
			}
			if (!a) return;
			s = a;
		}
		if (n(Le(e, r[s - 1])) < 2) return;
	}
	return [
		Le(e, r[s - 1]),
		Le(e, r[s - 1], !0),
		s
	];
}
function He(e, t) {
	let n = Ie(e);
	return t > 0 && t < n.length ? Le(e, n[t - 1], !0) : void 0;
}
function Ue(e, t) {
	for (let n of e) for (let e of Array.from(n.querySelectorAll("[data-doc-field=\"num_pages\"]"))) e.textContent = String(t), e.removeAttribute("aria-label");
}
function We(e, t, n) {
	e.setAttribute("aria-label", `文档预览页 ${t + 1}`);
	let r = e.querySelector(":scope > .doc-page-label");
	if (r && (r.textContent = `预览 ${t + 1}`), e.dataset.pageNumber !== String(n)) {
		e.dataset.pageNumber = String(n);
		for (let t of Array.from(e.querySelectorAll("[data-doc-field=\"page_number\"]"))) t.textContent = String(n);
	}
}
async function Ge(e, t, n, r = () => {}, i, a = {}) {
	let o = [], s = [], c = [], l = a.resume, u = l?.page ?? 0, d = () => a.urgent?.() === !0, f = 1, p = 0, m = 0, h, g = Symbol("pagination converged"), _ = () => new DOMException("分页已取消", "AbortError"), v, y = () => {
		if (v) return v;
		let t = e.reduce((e, t) => e + (t.element.textContent?.length ?? 0) + t.element.querySelectorAll("*").length + 1, 0);
		return v = {
			total: String(t).length,
			number: String(t + Math.max(1, ...e.map((e) => e.restart ?? 1))).length
		}, v;
	}, b = (e, t = !0) => {
		for (let n of Array.from(e.querySelectorAll("[data-doc-field=\"num_pages\"], [data-doc-field=\"page_number\"]"))) {
			let e = n.dataset.docField === "num_pages";
			n.textContent = e ? "…" : String(f), n.style.display = t ? "inline-block" : "inline", n.style.width = t ? `${e ? y().total : y().number}ch` : "", n.style.textAlign = t ? "right" : "", n.style.textIndent = "0", n.style.whiteSpace = "nowrap", e && n.setAttribute("aria-label", "总页数计算中");
		}
	}, x = performance.now(), S = () => !d() && performance.now() - x >= 12, C = async (e = !1) => {
		r(p), await new Promise((t) => {
			if (!e || document.hidden) {
				setTimeout(t, 0);
				return;
			}
			let n = 0, r = () => {
				clearTimeout(i), cancelAnimationFrame(n), t();
			}, i = setTimeout(r, 50);
			n = requestAnimationFrame(() => setTimeout(r, 0));
		}), x = performance.now();
	}, w = async (e = !1) => {
		if (!e && (p === m || !d() && p - m < 10)) return;
		if (n()) throw _();
		let t = m, r = o.slice(m, p);
		if (m = p, i && (await i({
			papers: r,
			infos: s.slice(t, p),
			warnings: [...new Set(c)],
			complete: e,
			stopped: e ? h : void 0
		}), !e && !d() && await C(!0)), n()) throw _();
	}, T = async (e) => {
		e.remove();
		for (let t of Array.from(e.querySelectorAll("[data-doc-field=\"page_number\"]"))) t.textContent = e.dataset.pageNumber ?? "";
		p++, await w();
	};
	try {
		try {
			for (let r = l?.info.cursor.source ?? 0; r < e.length; r++) {
				let i = e[r], d = l && r === l.info.cursor.source ? l.info : void 0;
				if (S() && await C(), n()) return {
					papers: [],
					infos: [],
					warnings: []
				};
				let p = i.element, m = p.querySelector(":scope > .doc-body"), v = Array.from(m.children), y = i.first;
				d ? (f = d.number, y = d.first) : i.first && i.restart != null && (f = i.restart);
				let x = [], w = 0, ee = (e) => {
					let t = e.cloneNode(!0);
					return b(t), {
						el: t,
						id: t.dataset.nodeId ?? "",
						kind: "fresh",
						part: 0
					};
				}, E = (e) => {
					for (; x.length <= e && w < v.length;) x.push(ee(v[w++]));
				}, D = (e) => ({
					source: r,
					id: e.id,
					kind: e.kind,
					part: e.part
				});
				if (d && d.cursor.id) {
					let e = v.findIndex((e) => e.dataset.nodeId === d.cursor.id);
					if (e < 0) throw Error("分页续排起点失效：节点已不在源中");
					if (w = e, d.cursor.kind !== "fresh") {
						let e = ee(v[w++]);
						if (d.cursor.kind === "text") {
							let t = He(e.el, d.cursor.part);
							if (!t) throw Error("分页续排起点失效：段落续排位置越界");
							x.push({
								el: t,
								id: e.id,
								kind: "text",
								part: d.cursor.part
							});
						} else if (d.cursor.kind === "caption") {
							let t = e.el.querySelector(":scope > figcaption");
							if (!t) throw Error("分页续排起点失效：题注已不存在");
							x.push({
								el: t,
								id: e.id,
								kind: "caption",
								part: 0
							});
						} else x.push({
							...e,
							kind: "rows",
							part: d.cursor.part
						});
					}
				}
				let O, k, A, j = (e) => {
					let n = u + o.length;
					O = p.cloneNode(!1), O.classList.remove("doc-source"), O.dataset.testid = "doc-page", O.setAttribute("aria-label", `文档预览页 ${n + 1}`), O.style.zoom = "1", O.dataset.pageNumber = String(f);
					let r = document.createElement("div");
					r.className = "doc-page-label", r.textContent = `预览 ${n + 1}`, O.append(r);
					let i = y ? "first" : f % 2 == 0 ? "even" : "default";
					for (let e of ["header", "footer"]) {
						let t = p.querySelector(`:scope > [data-running="${e}-${i}"]`);
						if (t.children.length) {
							let n = t.cloneNode(!0);
							n.removeAttribute("data-running"), n.dataset.testid = `doc-${e}`;
							for (let e of Array.from(n.querySelectorAll(".doc-float"))) O.append(e);
							e === "header" ? O.append(n) : O.dataset.footerPending = "1", e === "footer" && (A = n);
						}
					}
					k = m.cloneNode(!1), k.className = "doc-body", k.dataset.testid = "doc-body", k.style.columnCount = "", Number(m.style.columnCount) > 1 && c.push("多栏当前按单栏分页展示；未声称还原源栏间布局。"), O.append(k), A &&= (O.append(A), void 0), O.removeAttribute("data-footer-pending"), b(O, !1);
					for (let e of Array.from(O.querySelectorAll("[data-doc-field=\"page_number\"]"))) e.textContent = String(f);
					t.append(O);
					let a = getComputedStyle(O), l = parseFloat(a.paddingTop), d = parseFloat(a.paddingBottom), h = O.querySelector(":scope > .doc-header"), g = O.querySelector(":scope > .doc-footer");
					h && (O.style.paddingTop = `${Math.max(l, parseFloat(getComputedStyle(h).top) + h.offsetHeight)}px`), g && (O.style.paddingBottom = `${Math.max(d, parseFloat(getComputedStyle(g).bottom) + g.offsetHeight)}px`), k.clientHeight < 24 && c.push("页眉页脚与边距占用过高，可用正文高度不足。"), o.push(O), s.push(e), f++, y = !1;
				}, M = () => k.scrollHeight <= k.clientHeight + 1, N = async (e) => {
					let t = {
						cursor: e,
						first: !1,
						number: f
					}, r = a.stop?.(u + o.length, t) === !0;
					if (await T(O), n()) throw _();
					if (r) throw h = {
						page: u + o.length,
						info: t
					}, g;
					j(t);
				}, te = async (e, t) => {
					let i = e.el, a = i.querySelector(":scope > table"), o = Array.from(a.querySelectorAll(":scope > tbody > tr")), s = o.filter((e) => e.dataset.previewHeader === "true"), l = [];
					for (let e = 0; e < o.length;) {
						let t = e + 1;
						for (let n = e; n < t; n++) for (let e of Array.from(o[n].cells)) t = Math.min(o.length, Math.max(t, n + e.rowSpan));
						l.push({
							rows: o.slice(e, t),
							start: e
						}), e = t;
					}
					let u = (e) => {
						let t = i.cloneNode(!1), n = a.cloneNode(!1);
						for (let e of Array.from(a.querySelectorAll(":scope > colgroup"))) n.append(e.cloneNode(!0));
						let r = document.createElement("tbody");
						if (n.append(r), t.append(n), e) for (let e of s) {
							let t = e.cloneNode(!0);
							t.dataset.previewRepeated = "true", r.append(t);
						}
						return k.append(t), {
							copy: t,
							tbody: r
						};
					}, d = "有表格单行或纵向合并组高于一页；当前保留全部内容并标明溢出，未裁切。", f = (t) => ({
						source: r,
						id: e.id,
						kind: "rows",
						part: l[t].start
					}), p = 0, m = 0, h;
					for (t > 0 ? (p = l.findIndex((e) => e.start >= t), p < 0 && (p = l.length), h = u(!0), p < l.length && (h.tbody.append(...l[p].rows.map((e) => e.cloneNode(!0))), M() || c.push(d), m = l[p].rows.length, p++)) : h = u(!1); p < l.length; p++) {
						if (S() && await C(), n()) throw _();
						let e = l[p].rows, t = e.map((e) => e.cloneNode(!0));
						if (h.tbody.append(...t), !M()) {
							for (let e of t) e.remove();
							m === 0 ? (h.copy.remove(), k.children.length && await N(f(p)), h = u(!1)) : (await N(f(p)), h = u(!0)), h.tbody.append(...t), m = 0, M() || c.push(d);
						}
						m += e.length;
					}
					let g = i.querySelector(":scope > figcaption");
					if (g) {
						let t = g.cloneNode(!0);
						if (h.copy.append(t), !M()) {
							t.remove();
							let n = {
								el: t,
								id: e.id,
								kind: "caption",
								part: 0
							};
							x.unshift(n), await N(D(n));
						}
					}
				};
				for (E(0), j({
					cursor: d?.cursor ?? (x[0] ? D(x[0]) : {
						source: r,
						id: "",
						kind: "fresh",
						part: 0
					}),
					first: y,
					number: f
				});;) {
					if (S() && await C(), n()) return {
						papers: [],
						infos: [],
						warnings: []
					};
					E(0);
					let e = x.shift();
					if (!e) break;
					let t = e.el;
					if (e.kind === "rows") await te(e, e.part);
					else {
						if (t.dataset.docPageBreakBefore === "true" && k.children.length && await N(D(e)), t.dataset.docKeepNext === "true" && k.children.length) {
							let n = [t];
							for (let e = 0;; e++) {
								E(e);
								let t = x[e]?.el;
								if (!t || t.dataset.docPageBreakBefore === "true" || n.length >= 256 || (n.push(t), t.dataset.docKeepNext !== "true")) break;
							}
							if (n.length > 1 && !Be(n, k)) {
								let t = Array.from(k.children);
								k.replaceChildren();
								let r = Be(n, k);
								k.append(...t), r ? await N(D(e)) : c.push("连续的与下段同页内容超过一页，预览按实际可用高度分开并保留全部内容。");
							}
						}
						if (k.append(t), !M()) {
							if (t.remove(), Re(t)) {
								if (t.dataset.docKeepLines === "true" && k.children.length && ze(t, k).height <= k.clientHeight + 1) {
									x.unshift(e), await N(D(e));
									continue;
								}
								let n = Ve(t, k, a.splitHint?.(e.id, e.part));
								if (n) {
									k.append(n[0]);
									let t = {
										el: n[1],
										id: e.id,
										kind: "text",
										part: e.part + n[2]
									};
									x.unshift(t), await N(D(t));
									continue;
								}
							}
							t.querySelector(":scope > table") ? await te(e, 0) : k.children.length ? (x.unshift(e), await N(D(e))) : (k.append(t), O.dataset.previewOverflow = "true", c.push("有图片、列表或不可拆分块高于一页；内容保留，尚需调整原始版式。"));
						}
					}
				}
				let P = e[r + 1], F;
				if (P && a.stop) {
					let e = P.element.querySelector(":scope > .doc-body")?.firstElementChild, t = {
						cursor: {
							source: r + 1,
							id: e?.dataset.nodeId ?? "",
							kind: "fresh",
							part: 0
						},
						first: P.first,
						number: P.first && P.restart != null ? P.restart : f
					};
					a.stop(u + o.length, t) && (F = t);
				}
				if (await T(O), F) throw h = {
					page: u + o.length,
					info: F
				}, g;
			}
		} catch (e) {
			if (e !== g) throw e;
		}
		for (let e of o) for (let t of Array.from(e.querySelectorAll("[data-doc-field=\"page_number\"]"))) t.textContent = e.dataset.pageNumber ?? "";
		return l || Ue(o, o.length), await w(!0), r(o.length), {
			papers: o,
			infos: s,
			warnings: [...new Set(c)],
			stopped: h
		};
	} catch (e) {
		if (n()) return {
			papers: [],
			infos: [],
			warnings: []
		};
		throw e;
	}
}
// packages/vue/src/chartGeometry.ts
var Ke = (e, t) => [...e].reduce((e, t) => e + (t.charCodeAt(0) > 11904 ? 1 : .55), 0) * t, qe = (e) => Number(e.toFixed(Math.abs(e) >= 100 ? 0 : 2)).toLocaleString("en-US", { maximumFractionDigits: 2 });
function Je(e, t) {
	let n = t?.split(";")[0] ?? "", r = n.search(/[0#]/);
	if (!t || t === "General" || r < 0) return qe(e);
	let i = n.length - [...n].reverse().join("").search(/[0#]/), a = (e) => e.replace(/"([^"]*)"/g, "$1").replace(/[\\_*]/g, ""), o = n.slice(r, i), s = n.replace(/"[^"]*"/g, "").includes("%"), c = (o.split(".")[1] ?? "").replace(/[^0#]/g, "").length, l = (s ? e * 100 : e).toLocaleString("en-US", {
		minimumFractionDigits: c,
		maximumFractionDigits: c,
		useGrouping: o.includes(",")
	});
	return a(n.slice(0, r)) + l + a(n.slice(i));
}
function Ye(e, t, n) {
	let r = n ?? 5, i = (t - e || Math.abs(t) || 1) / r, a = 10 ** Math.floor(Math.log10(i));
	for (i = ([
		1,
		2,
		2.5,
		5,
		10
	].find((e) => e * a >= i - 1e-12) ?? 10) * a;;) {
		let r = Math.floor(e / i + 1e-9) * i, a = n ?? Math.max(1, Math.ceil(t / i - 1e-9) - Math.floor(e / i + 1e-9));
		if (r + a * i >= t - 1e-9) return {
			min: r,
			max: r + a * i,
			count: a
		};
		i *= 2;
	}
}
function Xe(e, t, n, r = {}) {
	let i = r.font ?? 12, a = (t) => `#${e.colors?.[t] ?? n[`accent${t % 6 + 1}`] ?? "4472C4"}`, o = {
		bars: [],
		paths: [],
		labels: [],
		legend: [],
		grid: [],
		axis: null,
		font: i
	}, s = e.kind === "pie" || e.kind === "doughnut", c = (t) => e.kind === "combo" ? t.kind ?? "column" : e.kind, l = s ? e.categories.map((e, t) => ({
		text: e,
		fill: a(t),
		line: !1
	})) : e.series.map((e, t) => ({
		text: e.name,
		fill: a(t),
		line: c(e) === "line"
	})), u = e.legend ? e.legendPosition ?? "bottom" : void 0, d = i * .8, f = (e) => d + i * .4 + Ke(e, i) + i, p = Math.min(t.width * .35, Math.max(0, ...l.map((e) => f(e.text)))), m = t.y + i * .8, h = t.y + t.height - i * .6, g = t.x + i * .6, _ = t.x + t.width - i * .6;
	if (e.title) {
		let n = Math.round(i * 1.4);
		o.title = {
			x: t.x + t.width / 2,
			y: m + n,
			text: e.title,
			size: n
		}, m += n * 1.8;
	}
	if (u === "top" || u === "bottom") {
		let e = l.reduce((e, t) => e + f(t.text), 0), n = t.x + Math.max(i, (t.width - e) / 2), r = u === "top" ? m + i : h;
		for (let e of l) o.legend.push({
			...e,
			x: n,
			y: r
		}), n += f(e.text);
		u === "top" ? m += i * 1.8 : h -= i * 1.8;
	} else if (u) {
		let e = u === "left" ? g : _ - p, t = (m + h) / 2 - (l.length - 1) * i * 1.5 / 2;
		l.forEach((n, r) => o.legend.push({
			...n,
			x: e,
			y: t + r * i * 1.5 + i * .4
		})), u === "left" ? g += p : _ -= p;
	}
	if (s) {
		let t = e.series[0]?.values ?? [], r = t.reduce((e, t) => e + (t > 0 ? t : 0), 0), s = (g + _) / 2, c = (m + h) / 2, l = Math.max(0, Math.min(_ - g, h - m) / 2 * (e.dataLabels ? .78 : .92)), u = e.kind === "doughnut" ? l * .64 : 0, d = (e, t) => `${s + t * Math.cos(e)} ${c + t * Math.sin(e)}`, f = -Math.PI / 2;
		return t.forEach((t, p) => {
			if (t <= 0 || r <= 0) return;
			let m = f + t / r * Math.PI * 2, h = +(m - f > Math.PI), g;
			if (t === r) {
				let e = (e, t) => `M ${s} ${c - e} A ${e} ${e} 0 1 ${t} ${s} ${c + e} A ${e} ${e} 0 1 ${t} ${s} ${c - e} Z`;
				g = e(l, 1) + (u ? ` ${e(u, 0)}` : "");
			} else g = u ? `M ${d(f, l)} A ${l} ${l} 0 ${h} 1 ${d(m, l)} L ${d(m, u)} A ${u} ${u} 0 ${h} 0 ${d(f, u)} Z` : `M ${s} ${c} L ${d(f, l)} A ${l} ${l} 0 ${h} 1 ${d(m, l)} Z`;
			if (o.paths.push({
				d: g,
				fill: a(p),
				stroke: `#${n.lt1 ?? "FFFFFF"}`,
				label: `${e.categories[p]}: ${t}`
			}), e.dataLabels) {
				let n = (f + m) / 2, r = u ? (l + u) / 2 : l + i * .6;
				o.labels.push({
					x: s + r * Math.cos(n),
					y: c + r * Math.sin(n) + i * .35,
					text: `${e.categories[p]} ${Je(t, e.numberFormat)}`,
					anchor: u || Math.abs(Math.cos(n)) < .2 ? "middle" : Math.cos(n) > 0 ? "start" : "end"
				});
			}
			f = m;
		}), o;
	}
	let v = e.kind === "bar", y = Math.max(1, e.categories.length), b = (t) => {
		let n = 0, r = 0, i = [], a = [];
		for (let o of e.series) !!o.secondary === t && o.values.forEach((t, o) => {
			Number.isFinite(t) && (e.stacked ? (t >= 0 ? i[o] = (i[o] ?? 0) + t : a[o] = (a[o] ?? 0) + t, n = Math.min(n, a[o] ?? 0), r = Math.max(r, i[o] ?? 0)) : (n = Math.min(n, t), r = Math.max(r, t)));
		});
		return {
			lo: n,
			hi: r
		};
	}, x = b(!1), S = Ye(x.lo, x.hi), C = e.series.some((e) => e.secondary), w = b(!0), T = C ? Ye(w.lo, w.hi, S.count) : void 0, ee = (e) => Array.from({ length: e.count + 1 }, (t, n) => qe(e.min + (e.max - e.min) * n / e.count)), E = ee(S), D = T ? ee(T) : [], O = (e) => Math.max(0, ...e.map((e) => Ke(e, i))) + i * .5;
	e.yTitle && (g += i * 1.4), e.xTitle && (h -= i * 1.4), v ? (g += Math.min(t.width * .3, Math.max(0, ...e.categories.map((e) => Ke(e, i))) + i * .6), h -= i * 1.5) : (g += O(E), h -= i * 1.5, T && (_ -= O(D)));
	let k = Math.max(0, _ - g), A = Math.max(0, h - m), j = (e, t) => {
		let n = t && T ? T : S, r = (e - n.min) / (n.max - n.min || 1);
		return v ? g + r * k : h - r * A;
	}, M = (v ? A : k) / y, N = (e) => (v ? m : g) + (e + .5) * M;
	E.forEach((t, n) => {
		let r = S.min + (S.max - S.min) * n / S.count, a = j(r);
		v ? (e.gridlines && o.grid.push({
			x1: a,
			x2: a,
			y1: m,
			y2: h
		}), o.labels.push({
			x: a,
			y: h + i * 1.2,
			text: t
		})) : (e.gridlines && o.grid.push({
			x1: g,
			x2: _,
			y1: a,
			y2: a
		}), o.labels.push({
			x: g - i * .4,
			y: a + i * .35,
			text: t,
			anchor: "end"
		}));
	}), T && D.forEach((e, t) => o.labels.push({
		x: _ + i * .4,
		y: h - A * t / T.count + i * .35,
		text: e,
		anchor: "start"
	})), e.categories.forEach((e, t) => o.labels.push(v ? {
		x: g - i * .4,
		y: N(t) + i * .35,
		text: e,
		anchor: "end"
	} : {
		x: N(t),
		y: h + i * 1.2,
		text: e
	})), e.yTitle && o.labels.push({
		x: t.x + i * 1.4,
		y: (m + h) / 2,
		text: e.yTitle,
		rotate: !0
	}), e.xTitle && o.labels.push({
		x: (g + _) / 2,
		y: h + i * 2.6,
		text: e.xTitle
	});
	let te = j(Math.min(Math.max(0, S.min), S.max));
	o.axis = v ? {
		x1: te,
		x2: te,
		y1: m,
		y2: h
	} : {
		x1: g,
		x2: _,
		y1: te,
		y2: te
	};
	let P = e.series.filter((e) => ["bar", "column"].includes(c(e))), F = M / ((e.stacked ? 1 : Math.max(1, P.length)) + 1.5), I = [], L = [];
	return e.series.forEach((t, n) => {
		let r = c(t), s = a(n);
		if (r === "bar" || r === "column") {
			let n = e.stacked ? 0 : P.indexOf(t);
			t.values.forEach((r, a) => {
				if (!Number.isFinite(r)) return;
				let c = 0;
				if (e.stacked) {
					let e = r >= 0 ? I : L;
					c = e[a] ?? 0, e[a] = c + r;
				}
				let l = j(c, t.secondary), u = j(c + r, t.secondary), d = (v ? m : g) + a * M + F * (.75 + n), f = `${t.name}: ${r}`;
				o.bars.push(v ? {
					x: Math.min(l, u),
					y: d,
					w: Math.abs(u - l),
					h: F,
					fill: s,
					label: f
				} : {
					x: d,
					y: Math.min(l, u),
					w: F,
					h: Math.abs(u - l),
					fill: s,
					label: f
				}), e.dataLabels && o.labels.push(v ? {
					x: u + i * .3,
					y: d + F / 2 + i * .35,
					text: Je(r, e.numberFormat),
					anchor: "start"
				} : {
					x: d + F / 2,
					y: Math.min(l, u) - i * .3,
					text: Je(r, e.numberFormat)
				});
			});
			return;
		}
		let l = [];
		if (t.values.forEach((n, r) => {
			if (!Number.isFinite(n)) return;
			let a = j(n, t.secondary);
			l.push(v ? [a, N(r)] : [N(r), a]), e.dataLabels && o.labels.push(v ? {
				x: a + i * .3,
				y: N(r),
				text: Je(n, e.numberFormat),
				anchor: "start"
			} : {
				x: N(r),
				y: a - i * .5,
				text: Je(n, e.numberFormat)
			});
		}), !l.length) return;
		let u = l.map(([e, t], n) => `${n ? "L" : "M"} ${e} ${t}`).join(" "), d = j(0, t.secondary), f = r === "area" ? v ? `M ${d} ${l[0][1]} ${u.replace(/^M/, "L")} L ${d} ${l.at(-1)[1]} Z` : `M ${l[0][0]} ${d} ${u.replace(/^M/, "L")} L ${l.at(-1)[0]} ${d} Z` : u;
		o.paths.push({
			d: f,
			fill: r === "area" ? s : "none",
			opacity: r === "area" ? .25 : void 0,
			stroke: s,
			label: `${t.name}: ${t.values.join(", ")}`
		});
	}), o;
}
// packages/vue/src/ChartSvg.vue?vue&type=script&setup=true&lang.ts
var Ze = { class: "chart" }, Qe = ["stroke"], $e = [
	"x",
	"y",
	"font-size",
	"fill"
], et = [
	"x",
	"y",
	"width",
	"height",
	"fill"
], tt = [
	"d",
	"fill",
	"fill-opacity",
	"stroke"
], Z = ["stroke"], nt = [
	"x",
	"y",
	"font-size",
	"text-anchor",
	"transform",
	"fill"
], rt = [
	"x1",
	"x2",
	"y1",
	"y2",
	"stroke"
], it = [
	"x",
	"y",
	"width",
	"height",
	"fill"
], at = [
	"x",
	"y",
	"font-size",
	"fill"
], ot = /* @__PURE__ */ ie({
	__name: "ChartSvg",
	props: {
		geom: {},
		ink: {}
	},
	setup(e) {
		return (t, n) => (U(), L("g", Ze, [
			(U(!0), L(N, null, G(e.geom.grid, (t, n) => (U(), L("line", V({ key: `r${n}` }, { ref_for: !0 }, t, {
				stroke: e.ink,
				"stroke-opacity": "0.15",
				"stroke-width": "0.75"
			}), null, 16, Qe))), 128)),
			e.geom.title ? (U(), L("text", {
				key: 0,
				x: e.geom.title.x,
				y: e.geom.title.y,
				"font-size": e.geom.title.size,
				"font-weight": "bold",
				"text-anchor": "middle",
				fill: e.ink
			}, K(e.geom.title.text), 9, $e)) : I("v-if", !0),
			(U(!0), L(N, null, G(e.geom.bars, (e, t) => (U(), L("rect", {
				key: t,
				x: e.x,
				y: e.y,
				width: e.w,
				height: e.h,
				fill: e.fill
			}, [R("title", null, K(e.label), 1)], 8, et))), 128)),
			(U(!0), L(N, null, G(e.geom.paths, (e, t) => (U(), L("path", {
				key: `p${t}`,
				d: e.d,
				fill: e.fill,
				"fill-opacity": e.opacity,
				"fill-rule": "evenodd",
				stroke: e.stroke,
				"stroke-width": "2",
				"stroke-linejoin": "round"
			}, [R("title", null, K(e.label), 1)], 8, tt))), 128)),
			e.geom.axis ? (U(), L("line", V({ key: 1 }, e.geom.axis, {
				stroke: e.ink,
				"stroke-opacity": "0.45",
				"stroke-width": "1"
			}), null, 16, Z)) : I("v-if", !0),
			(U(!0), L(N, null, G(e.geom.labels, (t, n) => (U(), L("text", {
				key: `l${n}`,
				x: t.x,
				y: t.y,
				"font-size": e.geom.font,
				"text-anchor": t.anchor ?? "middle",
				transform: t.rotate ? `rotate(-90 ${t.x} ${t.y})` : void 0,
				fill: e.ink,
				"fill-opacity": "0.8"
			}, K(t.text), 9, nt))), 128)),
			(U(!0), L(N, null, G(e.geom.legend, (t, n) => (U(), L("g", { key: `g${n}` }, [t.line ? (U(), L("line", {
				key: 0,
				x1: t.x,
				x2: t.x + e.geom.font * .8,
				y1: t.y - e.geom.font * .35,
				y2: t.y - e.geom.font * .35,
				stroke: t.fill,
				"stroke-width": "2"
			}, null, 8, rt)) : (U(), L("rect", {
				key: 1,
				x: t.x,
				y: t.y - e.geom.font * .8,
				width: e.geom.font * .8,
				height: e.geom.font * .8,
				fill: t.fill
			}, null, 8, it)), R("text", {
				x: t.x + e.geom.font * 1.2,
				y: t.y,
				"font-size": e.geom.font,
				fill: e.ink
			}, K(t.text), 9, at)]))), 128))
		]));
	}
}), st = { class: "doc-toolbar" }, ct = { key: 0 }, lt = ["value"], ut = ["disabled"], dt = {
	key: 1,
	class: "doc-preview-note",
	role: "note"
}, ft = {
	key: 2,
	class: "doc-preview-note"
}, pt = ["aria-busy", "data-pagination-complete"], mt = ["data-flow-source"], ht = ["contenteditable"], gt = ["data-page-number"], _t = { class: "doc-page-label" }, vt = ["data-testid"], yt = ["contenteditable"], bt = ["aria-busy", "data-pagination-complete"], xt = {
	key: 5,
	role: "status",
	class: "doc-pagination-status"
}, St = ["data-running"], Ct = ["data-running"], wt = ["id"], Tt = "\0current", Et = 1.2, Dt = "28px", Ot = ".doc-running,.doc-page-label,[data-preview-repeated],.doc-list-label,.doc-list-marker,[data-doc-atom]:not(br),.doc-toc,.doc-image-placeholder,pre[data-node-id],hr,figcaption,img,svg", kt = 18, At = /*#__PURE__*/ ((e, t) => {
	let n = e.__vccOpts || e;
	for (let [e, r] of t) n[e] = r;
	return n;
})(/* @__PURE__ */ ie({
	__name: "DocsPreview",
	props: {
		model: {},
		context: {},
		compact: { type: Boolean },
		controlsTarget: {},
		embeddedFonts: {},
		fontRevision: {},
		selectionOffsetUnit: {},
		editable: { type: Boolean },
		bare: { type: Boolean },
		zoom: {},
		engine: {}
	},
	emits: [
		"pagination",
		"selection-change",
		"pages-changing",
		"pages-changed"
	],
	setup(f, { expose: g, emit: _ }) {
		let v = f, y = _, b = P(() => v.editable ? v.model : v.context.document ?? v.model), x = P(() => o(v.model, b.value)), S = W(), C = W(), w = W(), T = W(0), ee = W(0), E = W(!1), D = W(!1), O = W([]), k = W(0), A = 0, j, M;
		function z() {
			M?.resolve("cancelled"), M = void 0;
		}
		function re() {
			if (!M) return;
			let e = M.locate();
			if (typeof e == "function") {
				let t = M;
				M = void 0, e(), t.resolve("found");
			} else (e === "missing" || D.value) && (M.resolve("missing"), M = void 0);
		}
		function ie(e) {
			return z(), Ce(void 0), new Promise((t) => {
				let n = ln();
				M = {
					locate: e,
					top: n?.scrollTop ?? 0,
					left: n?.scrollLeft ?? 0,
					resolve: t
				}, re();
			});
		}
		function V(e) {
			return () => {
				if ($.value && !D.value) return "pending";
				let t = ($.value ? C.value?.querySelector(`.doc-flow__body ${e}`) : void 0) ?? C.value?.querySelector(e);
				return t ? () => t.scrollIntoView({ block: "center" }) : $.value ? "missing" : "pending";
			};
		}
		function de(e) {
			return ie(V(`[data-node-id="${CSS.escape(e)}"]`));
		}
		function q(e) {
			if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			let t = e.target.closest("a[href^=\"#doc-bm-\"]");
			if (t) {
				e.preventDefault();
				try {
					ie(V(`#${CSS.escape(decodeURIComponent(t.hash.slice(1)))}`));
				} catch {}
			}
		}
		let J = new t(), Y = new n(), he = new r(), ge = /* @__PURE__ */ new Map(), _e, ve = /* @__PURE__ */ new Map(), ye = [];
		function be() {
			ve = /* @__PURE__ */ new Map();
			let e = (e, t, n) => {
				for (let r of n.text ? [n.node] : n.targets) {
					let i = ve.get(r) ?? [];
					i.push({
						key: e,
						tone: t,
						range: n
					}), ve.set(r, i);
				}
			};
			for (let { entry: t, ranges: n } of ge.values()) for (let r of n ?? []) e(t.key, t.tone, r);
			for (let t of _e ?? []) e(Tt, "current", t);
		}
		function X(e, t, n) {
			let r = a(e, t, n);
			return r && {
				startContainer: r.start.node,
				startOffset: r.start.offset,
				endContainer: r.end.node,
				endOffset: r.end.offset
			};
		}
		function xe(e, t) {
			for (let n of J.pageFragments(e)) if (n.role !== "repeat") for (let e of ve.get(n.node) ?? []) {
				if (t != null && e.key !== t) continue;
				if (!e.range.text) {
					Y.addElement(e.key, e.tone, n.element);
					continue;
				}
				if (n.kind !== "text") continue;
				let r = J.textMap(n), i = Math.max(e.range.start, r.start), a = Math.min(e.range.end, r.end), o = i < a ? X(r, i, a) : void 0;
				o && Y.addRange(e.key, e.tone, new StaticRange(o));
			}
		}
		function Se(e) {
			if ($.value) return Cr(e);
			xe(-1, e);
			for (let t = 0; t < J.pageCount; t++) xe(t, e);
		}
		function Ce(e) {
			(_e || e) && (Y.remove(Tt), _e = e, be(), e && Se(Tt));
		}
		function we(e) {
			let t = ge.get(e.key);
			return !he.has(e) || t?.entry !== e || !!t.status;
		}
		function Te(e, t = !1) {
			let n = ge.get(e.key);
			return !he.has(e) || n?.entry !== e ? "cancelled" : n.status ? n.status : t ? "cancelled" : $.value ? Sr(n.ranges ?? []) ? "found" : "missing" : p(J, n.ranges ?? [], !0).status === "found" ? "found" : "missing";
		}
		function Ee(e = !1) {
			let t = e || D.value;
			if (t && !e) for (let [e, t] of ge) t.ranges && !($.value ? Sr(t.ranges) : p(J, t.ranges, !0).status === "found") && Y.remove(e);
			let n = t ? ye : ye.filter((e) => e.entries.every(we));
			if (n.length) {
				ye = ye.filter((e) => !n.includes(e));
				for (let t of n) t.resolve(t.entries.map((t) => ({
					id: t.id,
					group: t.group,
					status: Te(t, e)
				})));
			}
		}
		function De() {
			he.clear(), ge.clear(), _e = void 0, be(), Y.clear(), Ee(!0);
		}
		function je(e) {
			let { added: t, removed: n } = he.set(e);
			for (let e of n) Y.remove(e.key), ge.delete(e.key);
			let r = i();
			for (let e of t) {
				let t = u(e.anchor, x.value);
				ge.set(e.key, t.ok ? !r && t.ranges.some((e) => e.text) ? {
					entry: e,
					status: "unsupported"
				} : {
					entry: e,
					ranges: t.ranges
				} : {
					entry: e,
					status: t.status
				});
			}
			be();
			for (let e of t) ge.get(e.key)?.ranges && Se(e.key);
			return new Promise((e) => {
				ye.push({
					entries: t,
					resolve: e
				}), Ee();
			});
		}
		function Me(e) {
			for (let t of he.clear(e)) Y.remove(t.key), ge.delete(t.key);
			e ?? (_e = void 0, Y.remove(Tt)), be(), Ee();
		}
		function Ne(e, t) {
			e.scrollIntoView({
				block: "nearest",
				inline: "nearest"
			});
			let n = ln();
			if (!n?.contains(e)) return;
			let r = t?.() ?? e.getBoundingClientRect(), i = n.getBoundingClientRect(), a = i.top + n.clientTop, o = i.left + n.clientLeft;
			n.scrollTop += r.height > n.clientHeight ? r.top - a - 10 : r.top + r.height / 2 - (a + n.clientHeight / 2), (r.left < o || r.right > o + n.clientWidth) && (n.scrollLeft += r.left + r.width / 2 - (o + n.clientWidth / 2));
		}
		function Pe(e) {
			let t = e.fragment.element;
			Ne(t, () => {
				let t = X(J.textMap(e.fragment), e.start, e.end);
				if (!t) return;
				let n = document.createRange();
				n.setStart(t.startContainer, t.startOffset), n.setEnd(t.endContainer, t.endOffset);
				let r = n.getClientRects()[0] ?? n.getBoundingClientRect();
				return r.width || r.height ? r : void 0;
			});
		}
		function Ie(e) {
			let t = u(e, x.value);
			if (!t.ok) return z(), Ce(void 0), Promise.resolve(t.status);
			let n = t.ranges, r = n[0];
			return $.value ? ie(() => D.value ? wr(n) : "pending") : ie(() => {
				if (r.text) {
					let { parts: e } = J.resolveText(r.node, r.start, r.end), t = e.find((e) => e.start === r.start && J.isCurrent(e.fragment));
					return t ? () => {
						Ce(n), Pe(t);
					} : "pending";
				}
				let e = J.resolveBlock(r.targets)[0];
				return e ? () => {
					Ce(n), Ne(e.element);
				} : "pending";
			});
		}
		function Le() {
			let e = window.getSelection();
			if (!e?.rangeCount || e.isCollapsed || !qe.value) return null;
			let t = e.getRangeAt(0);
			if (!t.intersectsNode(qe.value)) return null;
			if ($.value) return xr(t);
			let n = [], r = (e) => {
				for (let r of J.pageFragments(e)) {
					if (r.kind !== "text") continue;
					let e = r.element;
					if (!t.intersectsNode(e)) continue;
					let i = J.textMap(r), a = e.contains(t.startContainer) ? d(i, r.element, t.startContainer, t.startOffset, "start") : i.start, o = e.contains(t.endContainer) ? d(i, r.element, t.endContainer, t.endOffset, "end") : i.end;
					a != null && o != null && o > a && n.push({
						node: r.node,
						start: a,
						end: o,
						role: r.role
					});
				}
			}, i = C.value?.children;
			for (let e = 0; e < J.pageCount; e++) {
				let n = i?.[e];
				n && t.intersectsNode(n) && r(e);
			}
			return w.value && t.intersectsNode(w.value) && r(-1), m(n, x.value, v.selectionOffsetUnit ?? "scalar");
		}
		let Re = 0, ze = "null";
		function Be() {
			Re = 0;
			let e = Le(), t = JSON.stringify(e);
			t !== ze && (ze = t, y("selection-change", e));
		}
		function Ve() {
			Re ||= requestAnimationFrame(Be);
		}
		function He(t) {
			J.addPage(t, t.querySelectorAll(e)), xe(J.pageCount - 1);
		}
		function Ke() {
			J.setNotes(w.value, w.value?.querySelectorAll(e)), xe(-1);
		}
		g({
			jumpToBlock: de,
			scrollToAnchor: Ie,
			setHighlights: je,
			clearHighlights: Me,
			surface: () => C.value,
			scroller: () => ln(),
			pointFromDom: Ln,
			caretFromDom: Bn,
			domFromPoint: Vn,
			pageOf: Hn,
			scrollToPage: Un,
			whenIdle: jn,
			hold: Mn,
			repaginate: pn,
			restore: kr,
			engine: () => $.value ? "flow" : "paged"
		});
		let qe = W(), Je = W(800), Ye = W("fit"), Ze, Qe = !1, $e;
		function et() {
			M && $e && ($e.scrollTop !== M.top || $e.scrollLeft !== M.left) && z();
		}
		function tt(e) {
			[
				"ArrowUp",
				"ArrowDown",
				"PageUp",
				"PageDown",
				"Home",
				"End",
				" "
			].includes(e.key) && z();
		}
		let Z = (e) => e == null ? void 0 : e / 9525, nt = P(() => v.model.unsupported?.some((e) => e.kind === "docx.theme")), rt, it = P(() => {
			let e = v.model.resources;
			return rt && rt.list === e || (rt = {
				list: e,
				map: new Map(e?.map((e) => [e.id, e]) ?? [])
			}), rt.map;
		}), at = [], At, jt = P(() => {
			let e = [], t = 1;
			for (let n of b.value.sections) {
				let r = [], i = !0;
				t = n.pageNumberStart ?? t;
				let a = () => {
					e.push({
						blocks: r,
						page: n.page ?? v.context.docs.page,
						header: n.header,
						footer: n.footer,
						section: n.id,
						first: i,
						restart: i ? n.pageNumberStart : void 0,
						number: t++
					}), r = [], i = !1;
				};
				for (let e of n.blocks) e.type === "page_break" ? a() : ((e.type === "paragraph" || e.type === "heading") && e.props?.pageBreakBefore && r.length && a(), r.push(e));
				(r.length || i) && a();
			}
			return at = e, e;
		});
		function Mt(e) {
			return e.orientation === "landscape" && e.size.width < e.size.height ? {
				width: e.size.height,
				height: e.size.width
			} : e.size;
		}
		let Nt = P(() => v.zoom == null ? Ye.value : v.zoom === "fit-width" ? "fit" : String(v.zoom)), Pt = P(() => Nt.value === "fit" ? Math.max(.2, Math.min(1, (Je.value - 20) / Math.max(...jt.value.map((e) => Z(Mt(e.page).width) ?? 794), 794))) : Math.max(.1, Number(Nt.value) || 1));
		function Ft(e, t = "inherit") {
			return ke(e, v.context.palette, t);
		}
		function It(e, t) {
			return Object.fromEntries(Object.entries({
				...e,
				...t
			}).filter(([, e]) => e != null));
		}
		function Lt(e) {
			return e ? {
				verticalAlign: "top",
				position: "relative",
				top: `calc(${(.3 * e).toFixed(3)}px - 0.35em)`
			} : {};
		}
		let Rt = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\u31F0-\u31FF\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u{20000}-\u{3FFFF}]/u, zt = /(?=\p{L})\p{Script=Latin}/u, Bt = /[0-9]/;
		function Vt(e, t, n) {
			if (!t) return !1;
			let r = Rt.test(e);
			if (r === Rt.test(t)) return !1;
			let i = r ? t : e;
			return n.de && zt.test(i) || n.dn && Bt.test(i);
		}
		function Ht(e, t, n) {
			if (!t.de && !t.dn) return e;
			let r = Array.from(e), i = [], a = "";
			for (let e = 0; e < r.length; e++) Vt(r[e], r[e + 1] ?? n, t) ? (a && i.push(a), a = "", i.push(B("span", {
				"data-doc-autospace": "",
				style: { marginRight: "0.25em" }
			}, r[e]))) : a += r[e];
			return i.length ? (a && i.push(a), i) : e;
		}
		function Ut(e) {
			return Oe([e.font?.kind === "named" ? e.font.value : e.font?.value === "heading" ? v.context.fonts.headingLatin : e.font?.value === "mono" ? v.context.fonts.mono : v.context.fonts.bodyLatin, e.fontEastAsia?.kind === "named" ? e.fontEastAsia.value : e.fontEastAsia?.value === "heading" ? v.context.fonts.headingZh : e.fontEastAsia?.value === "mono" ? v.context.fonts.mono : v.context.fonts.bodyZh], "serif", v.embeddedFonts?.families, v.embeddedFonts?.latinFamilies);
		}
		function Wt(e, t) {
			let n = [e.underline === "none" ? "" : e.underline || e.link ? "underline" : "", e.strike ? "line-through" : ""].filter(Boolean).join(" ");
			return {
				fontWeight: e.bold == null ? void 0 : e.bold ? 700 : 400,
				fontStyle: e.italic == null ? void 0 : e.italic ? "italic" : "normal",
				textDecoration: n || "none",
				color: Ft(e.color, e.link ? `#${v.context.palette.hlink}` : "inherit"),
				backgroundColor: e.highlight ? Ft(e.highlight, "transparent") : e.code ? "#f1f5f9" : void 0,
				fontFamily: Ut(e),
				fontSize: e.size ? `${e.size / 100}pt` : void 0,
				verticalAlign: e.verticalAlign === "superscript" ? "super" : e.verticalAlign === "subscript" ? "sub" : "baseline",
				...e.verticalAlign === "superscript" || e.verticalAlign === "subscript" ? {} : Lt(t),
				whiteSpace: "pre-wrap",
				letterSpacing: e.letterSpacing == null ? void 0 : `calc(var(--doc-grid-spacing, 0pt) + ${Z(e.letterSpacing)}px)`
			};
		}
		function Gt(e) {
			return `doc-bm-${e}`;
		}
		function Kt(e) {
			return `#${encodeURIComponent(Gt(e))}`;
		}
		function qt(e) {
			return /^(https?:\/\/|mailto:|#)/i.test(e) ? e : void 0;
		}
		function Jt(e, t, n, r, i) {
			let a = it.value.get(e);
			return !a || a.data.kind !== "bytes" || !["image/png", "image/jpeg"].includes(a.mime) ? B("span", {
				class: "doc-image-placeholder",
				role: "note",
				"data-doc-atom": i
			}, `〔${t || "图片"}：未嵌入或未支持，未联网读取〕`) : B("img", {
				"data-doc-atom": i,
				src: `data:${a.mime};base64,${a.data.value}`,
				alt: t ?? a.name ?? "内嵌图片",
				style: {
					maxWidth: "100%",
					width: Z(n) ? `${Z(n)}px` : void 0,
					height: Z(r) ? `${Z(r)}px` : "auto",
					objectFit: "contain"
				},
				loading: $.value ? "eager" : "lazy"
			});
		}
		function Yt(e, t) {
			let n = it.value.get(e.resource);
			if (!n || n.data.kind !== "bytes" || !["image/png", "image/jpeg"].includes(n.mime)) return Jt(e.resource, e.alt, e.width, e.height, t);
			let r = Z(e.width) ?? 0, i = Z(e.height) ?? 0, a = (e, t, n, r, i) => {
				let a = e.from === "page" ? "0px" : `var(${n})`, o = e.from === "page" ? `var(${i})` : `(var(${i}) - var(${n}) - var(${r}))`;
				return e.align === "center" ? `calc(${a} + (${o} - ${t}px) / 2)` : e.align === "end" ? `calc(${a} + ${o} - ${t}px)` : `calc(${a} + ${e.align ? 0 : Z(e.offset) ?? 0}px)`;
			}, o = e.anchor;
			return B("img", {
				class: "doc-float",
				"data-doc-atom": t,
				"data-behind": o.behindText ? "true" : void 0,
				src: `data:${n.mime};base64,${n.data.value}`,
				alt: e.alt ?? n.name ?? "浮动图片",
				style: {
					left: a(o.x, r, "--doc-margin-left", "--doc-margin-right", "--doc-page-width"),
					top: a(o.y, i, "--doc-margin-top", "--doc-margin-bottom", "--doc-page-height"),
					width: `${r}px`,
					height: `${i}px`
				}
			});
		}
		function Xt(e, t, n, r, i) {
			let a = (n ?? 5486400) / 12700, o = (r ?? 3200400) / 12700, s = Xe(e, {
				x: 0,
				y: 0,
				width: a,
				height: o
			}, v.context.palette, { font: 10 });
			return B("svg", {
				class: "doc-chart",
				"data-doc-atom": i,
				role: "img",
				"aria-label": t ?? e.title ?? "图表",
				viewBox: `0 0 ${a} ${o}`,
				style: {
					width: `${Z(n ?? 5486400)}px`,
					maxWidth: "100%",
					height: "auto",
					fontFamily: "sans-serif"
				}
			}, [B(ot, {
				geom: s,
				ink: `#${v.context.palette.dk1}`
			})]);
		}
		function Zt(e) {
			return e?.type === "run" ? Array.from(e.text)[0] : void 0;
		}
		function Qt(e, t = {}, n = 0, r = {
			de: !0,
			dn: !0
		}) {
			let i = s(e);
			return e.map((a, o) => {
				let s = i[o];
				if (a.type === "run") {
					let n = It(t, v.context.characters[a.props?.style ?? ""]);
					n = It(n, a.props);
					let i = n.link ? qt(n.link.href) : void 0;
					return B(i ? "a" : "span", {
						key: o,
						"data-doc-run": s,
						style: Wt(n, r.fixedLine),
						...i ? {
							href: i.startsWith("#") ? Kt(i.slice(1)) : i,
							target: i.startsWith("#") ? void 0 : "_blank",
							rel: "noopener noreferrer",
							title: n.link?.title
						} : {}
					}, Ht(a.text, r, Zt(e[o + 1])));
				}
				if (a.type === "break") return B("br", {
					key: o,
					"data-doc-atom": s
				});
				if (a.type === "tab") return B("span", {
					key: o,
					"data-doc-atom": s,
					style: { whiteSpace: "pre" }
				}, "	");
				if (a.type === "image") return a.anchor ? Yt(a, s) : Jt(a.resource, a.alt, a.width, a.height, s);
				if (a.type === "chart") return Xt(a.chart, a.alt, a.width, a.height, s);
				if (a.type === "bookmark") return B("span", {
					key: o,
					id: Gt(a.name),
					class: "doc-bookmark",
					"data-doc-atom": s
				});
				if (a.type === "footnote_ref") return B("sup", { "data-doc-atom": s }, [B("a", { href: `#doc-note-${encodeURIComponent(a.id)}` }, `[${a.id}]`)]);
				let c = a.kind === "page_number" ? String(At?.number ?? at[n]?.number ?? n + 1) : a.kind === "num_pages" ? String(At?.total ?? at.length) : a.kind === "title" ? v.model.meta?.title : a.kind === "author" ? v.model.meta?.author : a.kind === "date" ? v.model.meta?.date : void 0;
				return B("span", {
					class: "doc-field",
					style: Lt(r.fixedLine),
					"data-doc-atom": s,
					"data-doc-field": a.kind,
					title: "域显示值按预览页/现有元数据展示，不代表Word重新计算"
				}, Ht(c ?? `〔${a.kind}域〕`, r));
			});
		}
		function $t(e) {
			return e ? e.style === "none" ? "none" : `${Z(e.width) ?? .667}px ${e.style === "single" ? "solid" : e.style} ${Ft(e.color, "currentColor")}` : void 0;
		}
		function en(e) {
			return {
				borderTop: $t(e?.top),
				borderBottom: $t(e?.bottom),
				borderLeft: $t(e?.left),
				borderRight: $t(e?.right)
			};
		}
		function tn(e, t, n) {
			if (e?.kind === "exact") return `${Z(e.value)}px`;
			if (e?.kind === "at_least") return `max(${Z(e.value)}px, ${Et}em)`;
			let r = e?.kind === "multiple" ? e.value / 1e3 : 1;
			if (n) {
				let e = t * 4 / 3 * Et;
				return `${Math.max(1, Math.ceil(e / n - .05)) * n * r}px`;
			}
			return r === 1 ? "normal" : String(r * Et);
		}
		function nn(e) {
			return `calc(${e / 100} * (1em + var(--doc-grid-spacing, 0pt)))`;
		}
		function rn(e, t, n = 0) {
			let r = e?.style ?? (t ? v.context.docs.headingStyles?.[t - 1] : v.context.docs.bodyStyle) ?? "Normal", i = nt.value && !e?.style ? void 0 : v.context.styles[r], a = It(i?.para, e);
			a.spacing = It(i?.para.spacing, e?.spacing), a.indent = It(i?.para.indent, e?.indent);
			let o = It(It(i?.run, a.run), e?.run), s = a.spacing?.line, c = at[n]?.page ?? v.context.docs.page, l = a.snapToGrid === !1 ? void 0 : c?.grid, u = l && l.kind !== "lines" && l.charSpace ? `${l.charSpace / 4096}pt` : void 0, d = a.indent ?? {}, f = d.firstLineChars ? nn(d.firstLineChars) : `${Z(d.firstLine ?? (d.hanging == null ? void 0 : -d.hanging)) ?? 0}px`, p = tn(s, (o.size ?? 1050) / 100, l ? Z(l.linePitch) : void 0);
			return {
				run: o,
				css: {
					...en(a.borders),
					fontWeight: o.bold ? 700 : 400,
					fontStyle: o.italic ? "italic" : "normal",
					fontSize: o.size ? `${o.size / 100}pt` : void 0,
					fontFamily: Ut(o),
					marginTop: `${Z(a.spacing?.before) ?? 0}px`,
					marginBottom: `${Z(a.spacing?.after) ?? 0}px`,
					textAlign: a.align === "center" ? "center" : a.align === "end" ? "right" : a.align === "justify" || a.align === "distributed" ? "justify" : "left",
					paddingLeft: d.startChars ? nn(d.startChars) : `${Z(d.start) ?? 0}px`,
					paddingRight: d.endChars ? nn(d.endChars) : `${Z(d.end) ?? 0}px`,
					textIndent: f,
					lineHeight: p,
					"--doc-grid-spacing": u,
					letterSpacing: u,
					tabSize: Dt,
					lineBreak: a.kinsoku === !1 ? "loose" : "strict",
					textSpacingTrim: a.topLinePunct ? "trim-start" : "space-all",
					backgroundColor: a.shading ? Ft(a.shading, "transparent") : void 0,
					breakInside: a.keepLines ? "avoid" : void 0,
					breakAfter: a.keepWithNext ? "avoid" : void 0,
					widows: a.widowControl === !1 ? 1 : 2,
					orphans: a.widowControl === !1 ? 1 : 2,
					textAutospace: "no-autospace",
					overflowWrap: "anywhere"
				},
				tabs: a.tabs,
				label: a.listLabel,
				hanging: d.firstLineChars ? d.firstLineChars < 0 ? nn(-d.firstLineChars) : void 0 : d.hanging ? `${Z(d.hanging)}px` : void 0,
				keepNext: a.keepWithNext,
				keepLines: a.keepLines,
				pageBreakBefore: a.pageBreakBefore,
				widowControl: a.widowControl,
				scriptSpacing: {
					de: a.autoSpaceDe !== !1,
					dn: a.autoSpaceDn !== !1,
					fixedLine: /^[\d.]+px$/.test(p) ? parseFloat(p) : void 0
				}
			};
		}
		function an(e, t, n = {}) {
			let r = { "data-node-id": e.id };
			switch (e.type) {
				case "paragraph":
				case "heading": {
					let i = rn(e.props, e.type === "heading" ? e.level : void 0, t), a = It(n, i.run), o = [];
					if (i.label) {
						let e = It(a, i.label.run), t = i.label.suffix ?? "tab";
						o.push(B("span", {
							class: "doc-list-label",
							"data-doc-list-label": i.label.level ?? 0,
							style: {
								...Wt(e, i.scriptSpacing.fixedLine),
								textDecoration: "none",
								...t === "tab" && i.hanging ? {
									display: "inline-block",
									minWidth: i.hanging,
									textIndent: 0
								} : {}
							}
						}, i.label.text + (t === "space" ? " " : t === "tab" && !i.hanging ? "	" : "")));
					}
					let c = Qt(e.inlines, a, t, i.scriptSpacing), l = e.inlines.findIndex((e) => e.type === "tab"), u = i.tabs?.length ? i.tabs[i.tabs.length - 1] : void 0, d = u?.kind === "end" && l >= 0 && e.inlines.filter((e) => e.type === "tab").length === 1 && !e.inlines.some((e) => e.type === "break");
					if (d) {
						let t = u.leader ?? "none";
						o.push(B("span", { style: { minWidth: 0 } }, c.slice(0, l)), B("span", {
							class: "doc-tab-leader",
							"data-doc-atom": s(e.inlines)[l],
							"data-doc-tab-leader": t,
							style: {
								flex: "1 1 0",
								minWidth: "1em",
								overflow: "hidden",
								whiteSpace: "nowrap",
								textIndent: 0
							}
						}, t === "none" ? "" : (t === "dot" ? "." : t === "hyphen" ? "-" : "_").repeat(400)), B("span", { style: {
							whiteSpace: "nowrap",
							textIndent: 0
						} }, c.slice(l + 1)));
					} else o.push(...c);
					return e.inlines.some((e) => e.type !== "bookmark" && !(e.type === "run" && !e.text)) || o.push(B("br", { "data-doc-empty-line": "" })), B(e.type === "heading" ? `h${e.level}` : "p", {
						...r,
						"data-doc-text": "",
						style: d ? {
							...i.css,
							display: "flex",
							alignItems: "baseline"
						} : i.css,
						"data-doc-keep-next": i.keepNext,
						"data-doc-keep-lines": i.keepLines,
						"data-doc-page-break-before": i.pageBreakBefore,
						"data-doc-widow-control": i.widowControl
					}, o);
				}
				case "list": return c(e) ? e.items.flatMap((e) => e.blocks.map((e) => on(e, t, n))) : B("div", {
					...r,
					class: "doc-list",
					role: "list"
				}, e.items.map((r, i) => B("div", {
					key: r.id,
					"data-item-id": r.id,
					role: "listitem",
					style: {
						display: "grid",
						gridTemplateColumns: "max-content minmax(0,1fr)",
						gap: "8px"
					}
				}, [B("span", { class: "doc-list-marker" }, Fe(e.kind, (e.start ?? 1) + i, r.checked)), B("div", {}, r.blocks.map((e) => on(e, t, n)))])));
				case "table": return sn(e, t, n);
				case "image": return B("figure", {
					...r,
					style: {
						margin: "12px 0",
						textAlign: e.align === "center" ? "center" : e.align === "end" ? "right" : "left"
					}
				}, [Jt(e.resource, e.alt, e.width, e.height), e.caption ? B("figcaption", {}, Qt(e.caption, n, t)) : null]);
				case "code_block": return B("pre", {
					...r,
					"data-doc-text": "",
					"data-doc-run": 0,
					style: {
						whiteSpace: "pre-wrap",
						overflowWrap: "anywhere",
						background: "#f1f5f9",
						padding: "12px",
						fontFamily: Ae("mono", v.context.fonts)
					}
				}, e.text);
				case "quote": return B("blockquote", {
					...r,
					style: {
						borderLeft: `3px solid #${v.context.palette.accent1}`,
						paddingLeft: "16px",
						margin: "12px 0"
					}
				}, e.blocks.map((e) => on(e, t, n)));
				case "container": return B("section", {
					...r,
					"data-container": e.kind,
					style: e.kind === "callout" ? {
						borderLeft: `4px solid #${v.context.palette.accent1}`,
						background: "#f8fafc",
						padding: "12px"
					} : void 0
				}, e.blocks.map((e) => on(e, t, n)));
				case "rule": return B("hr", r);
				case "page_break": return B("hr", {
					...r,
					"aria-label": "显式分页"
				});
				case "toc": return B("aside", {
					...r,
					class: "doc-toc"
				}, [B("strong", {}, e.title ?? "目录"), B("p", {}, "目录域需要Word更新；预览显示现有文档内容。")]);
			}
		}
		function on(e, t, n = {}) {
			return an(e, t, n);
		}
		function sn(e, t, n) {
			let r = v.context.tables[e.props?.style ?? ""], i = {
				...r?.props,
				...e.props
			}, a = e.colWidths?.length ? e.colWidths.reduce((e, t) => e + t, 0) : void 0, o = h(e.rows);
			return B("figure", {
				"data-node-id": e.id,
				style: { margin: nt.value ? 0 : "12px 0" }
			}, [B("table", {
				class: nt.value ? "doc-table doc-table--word" : "doc-table",
				style: {
					width: i.width?.kind === "emu" ? `${Z(i.width.value)}px` : i.width?.kind === "pct" ? `${i.width.value / 10}%` : a != null && nt.value ? `${Z(a)}px` : "100%",
					marginLeft: i.align === "center" || i.align === "end" ? "auto" : void 0,
					marginRight: i.align === "center" ? "auto" : void 0,
					borderCollapse: "collapse",
					...i.borders ? en(i.borders) : {},
					tableLayout: "fixed"
				}
			}, [e.colWidths?.length ? B("colgroup", {}, e.colWidths.map((e) => B("col", { style: { width: `${Z(e)}px` } }))) : null, B("tbody", {}, e.rows.map((a, s) => {
				let c = a.header || s < (i.headerRows ?? 0);
				return B("tr", {
					key: a.id,
					"data-row-id": a.id,
					"data-row-index": s,
					"data-preview-header": c ? "true" : void 0,
					style: {
						height: Z(a.height) ? `${Z(a.height)}px` : void 0,
						breakInside: "avoid"
					}
				}, a.cells.map((a, l) => {
					let u = {
						...r?.cell,
						...c ? r?.headerCell : {},
						...a.props
					}, d = It(It(n, r?.run), c ? r?.headerRun : {}), f = i.borders, p = u.borders, m = f ? {
						borderTop: $t(p?.top ?? f.insideH ?? f.top),
						borderBottom: $t(p?.bottom ?? f.insideH ?? f.bottom),
						borderLeft: $t(p?.left ?? f.insideV ?? f.left),
						borderRight: $t(p?.right ?? f.insideV ?? f.right)
					} : {
						border: "1px solid #94a3b8",
						...en(p)
					}, h = Z(i.cellMargin) ?? (nt.value ? 7.2 : 6), g = Z(i.cellMarginVertical) ?? (nt.value ? 0 : Z(i.cellMargin) ?? 6);
					return B(c ? "th" : "td", {
						key: a.id,
						"data-cell-id": a.id,
						"data-col-index": o[s][l].col,
						colspan: a.colSpan ?? 1,
						rowspan: a.rowSpan ?? 1,
						style: {
							...m,
							width: !e.colWidths?.length && u.width ? `${Z(u.width)}px` : void 0,
							padding: `${g}px ${h}px`,
							verticalAlign: u.valign === "center" ? "middle" : u.valign ?? "top",
							background: u.shading ? Ft(u.shading, "transparent") : void 0,
							overflowWrap: "anywhere",
							textAlign: "left"
						}
					}, a.blocks.map((e) => on(e, t, d)));
				}));
			}))]), e.caption ? B("figcaption", {}, Qt(e.caption, n, t)) : null]);
		}
		function cn(e) {
			return {
				width: `${Z(Mt(e.page).width)}px`,
				height: `${Z(Mt(e.page).height)}px`,
				minHeight: `${Z(Mt(e.page).height)}px`,
				maxHeight: `${Z(Mt(e.page).height)}px`,
				padding: `${Z(e.page.margins.top)}px ${Z(e.page.margins.right)}px ${Z(e.page.margins.bottom)}px ${Z(e.page.margins.left + (e.page.margins.gutter ?? 0))}px`,
				"--doc-header-offset": `${Z(e.page.margins.header ?? 54e4)}px`,
				"--doc-footer-offset": `${Z(e.page.margins.footer ?? 63e4)}px`,
				"--doc-margin-left": `${Z(e.page.margins.left + (e.page.margins.gutter ?? 0))}px`,
				"--doc-margin-right": `${Z(e.page.margins.right)}px`,
				"--doc-margin-top": `${Z(e.page.margins.top)}px`,
				"--doc-margin-bottom": `${Z(e.page.margins.bottom)}px`,
				"--doc-page-width": `${Z(Mt(e.page).width)}px`,
				"--doc-page-height": `${Z(Mt(e.page).height)}px`,
				zoom: 1,
				fontFamily: Ae("body", v.context.fonts),
				color: `#${v.context.palette.dk1}`
			};
		}
		function ln() {
			return v.compact ? qe.value?.closest("[data-document-scroll]") ?? C.value : C.value;
		}
		function un() {
			if (z(), $.value) return br(k.value);
			let e = C.value?.children[k.value], t = ln();
			t && e && (t.scrollTop += e.getBoundingClientRect().top - t.getBoundingClientRect().top - t.clientTop - (v.compact ? 20 : 10));
		}
		function dn(e) {
			let t = e.firstElementChild;
			t && (e.style.width = `${parseFloat(t.style.width) * Pt.value}px`, e.style.height = `${parseFloat(t.style.height) * Pt.value}px`, t.style.transform = `scale(${Pt.value})`);
		}
		function fn() {
			for (let e of Array.from(C.value?.children ?? [])) dn(e);
		}
		async function pn() {
			if ($.value) return qn.value++, await ae(), Or();
			if (yn) {
				bn = "full";
				return;
			}
			Sn?.cancel(), Sn = void 0, Cn = !0, On(!1);
			let t = ++A, n = b.value, r = jt.value, i = v.model;
			mn = !1, vn = void 0;
			for (let e of Q) e.stale = !0;
			let a = !!v.editable && !!C.value?.children.length, o = j === n || a;
			if (a || J.reset(t), Y.clear(), E.value = !0, D.value = !1, T.value = o ? C.value?.children.length ?? 0 : 0, ee.value = 0, O.value = [], y("pagination", {
				pages: T.value,
				complete: !1
			}), o || (z(), De(), k.value = 0), await ae(), t !== A || !S.value || !C.value) return;
			if (Ke(), !o) {
				C.value.replaceChildren(), Q = [];
				let e = ln();
				e && (e.scrollTop = 0);
			}
			if (j = n, !qe.value?.getClientRects().length) {
				Qe = !0, E.value = !1, An();
				return;
			}
			if (Qe = !1, await Promise.race([window.document.fonts.ready, new Promise((e) => setTimeout(e, 900))]), t !== A || !S.value || !C.value || (await Promise.allSettled(Array.from(S.value.querySelectorAll("img")).map((e) => (e.loading = "eager", e.decode()))), t !== A)) return;
			if (!qe.value?.getClientRects().length) {
				Qe = !0, E.value = !1;
				return;
			}
			let s = window.document.createElement("div");
			S.value.append(s);
			let c = cr(n), l = 0;
			try {
				await Ge(Array.from(S.value.querySelectorAll(":scope > article")).map((e, t) => ({
					element: e,
					first: jt.value[t].first,
					restart: jt.value[t].restart
				})), s, () => t !== A, () => {}, async (n) => {
					if (t !== A || !C.value) return;
					let o = ln(), s = o?.scrollTop ?? 0, u = l;
					if (n.papers.length && y("pages-changing"), n.papers.forEach((t, r) => {
						let i = Nn(t), o = C.value.children[l];
						o ? o.replaceWith(i) : C.value.append(i), a ? (J.splice(l, +(l < J.pageCount), [{
							root: i,
							found: i.querySelectorAll(e)
						}]), xe(l)) : He(i), Q[l] = {
							info: n.infos[r],
							stale: !1
						}, l++;
					}), n.complete) {
						for (; C.value.children.length > l;) C.value.lastElementChild?.remove();
						Q.length = l, a && J.pageCount > l && J.splice(l, J.pageCount - l, []), k.value = Math.min(k.value, Math.max(0, l - 1));
					}
					T.value = C.value.children.length, ee.value = l, D.value = n.complete, O.value = [...n.warnings, ...c], o && (o.scrollTop = s), n.complete && (hn = r, gn = i, kn()), n.papers.length && y("pages-changed", {
						from: u,
						count: n.papers.length
					}), y("pagination", {
						pages: T.value,
						complete: n.complete,
						warnings: O.value
					}), await ae(), t === A && (re(), n.complete && Ee());
				});
			} catch (e) {
				if (t !== A) return;
				z(), Ee(!0), O.value = [`分页未完成：${String(e)}。请查看大纲或下载原文件；未将失败标作格式还原成功。`];
			} finally {
				s.remove(), t === A && (Cn = !1, E.value = !1, An());
			}
		}
		let Q = [], mn = !1, hn, gn, _n, vn, yn = !1, bn = "none", xn, Sn, Cn = !1, wn = [];
		function Tn(e) {
			return e.type === "list" && c(e) ? e.items.flatMap((e) => e.blocks.flatMap(Tn)) : [e.id];
		}
		let En = (e) => `${e.source}\u0000${e.id}\u0000${e.kind}\u0000${e.part}`;
		function Dn(e) {
			for (let t of Array.from(e.querySelectorAll(Ot))) t.setAttribute("contenteditable", "false");
		}
		function On(e) {
			S.value?.classList.toggle("doc-measure--parked", e && !!v.editable);
		}
		function kn() {
			On(!0), mn = !0, vn = void 0;
			for (let e of Q) e.stale = !1;
			_n = (hn ?? []).map((e) => e.blocks), An();
		}
		function An() {
			let e = wn;
			wn = [];
			for (let t of e) t();
		}
		function jn() {
			return $.value && E.value ? new Promise((e) => wn.push(e)) : $.value ? ae().then(() => new Promise((e) => {
				let t = setTimeout(e, 60);
				requestAnimationFrame(() => {
					clearTimeout(t), e();
				});
			})) : !E.value && !yn ? Promise.resolve() : new Promise((e) => wn.push(e));
		}
		function Mn(e) {
			if ($.value || yn === e) return;
			if (yn = e, yn) {
				E.value && (bn = Cn ? "full" : bn === "none" ? "update" : bn, Sn?.cancel(), Sn = void 0, A++);
				return;
			}
			let t = bn;
			bn = "none", t === "full" ? pn() : t !== "none" && Fn(t === "force");
		}
		function Nn(e) {
			let t = window.document.createElement("div");
			return t.className = "doc-paper-wrap", t.append(e), dn(t), v.editable && Dn(t), t;
		}
		function Pn() {
			C.value && Ue(Array.from(C.value.querySelectorAll(".doc-paper")), C.value.children.length);
		}
		async function Fn(t = !1) {
			if ($.value) return;
			if (yn) {
				bn = bn === "full" ? "full" : t || bn === "force" ? "force" : "update";
				return;
			}
			Sn?.cancel(), Sn = void 0;
			let n = hn, r = jt.value, i = v.model;
			if (!v.editable || !mn || !n || !_n || !Q.length || Qe || n.length !== r.length || _n.length !== r.length || !C.value || !S.value || C.value.children.length !== Q.length || gn?.resources !== i.resources || gn?.footnotes !== i.footnotes || gn?.meta !== i.meta) return pn();
			let a = (e, t) => e.length !== t.length || e.some((e, n) => e !== t[n]), o = -1, s = -1;
			for (let e = 0; e < r.length; e++) {
				let t = n[e], i = r[e];
				if (t.page !== i.page || t.header !== i.header || t.footer !== i.footer || t.first !== i.first || t.restart !== i.restart || t.section !== i.section) return pn();
				o < 0 && a(t.blocks, i.blocks) && (o = e), a(_n[e], i.blocks) && (s = e);
			}
			let c = Q.findIndex((e) => e.stale), l = o < 0 && t && !!xn && xn.source < r.length;
			if (o < 0 && c < 0 && !l) {
				hn = r, gn = i;
				return;
			}
			let u = ++A, d = C.value, f = Array.from(S.value.querySelectorAll(":scope > article")), p = (e) => Array.from(f[e]?.querySelector(":scope > .doc-body")?.children ?? []).map((e) => e.dataset.nodeId ?? ""), m = (e) => e.reduce((e, t) => e + Tn(t).length, 0), h = (e, t) => {
				let n = 0;
				for (; n < e.length && n < t.length && e[n] === t[n];) n++;
				return n;
			}, g = (e, t, n) => {
				let r = 0;
				for (; r < e.length - n && r < t.length - n && e[e.length - 1 - r] === t[t.length - 1 - r];) r++;
				return r;
			}, _ = /* @__PURE__ */ new Map(), b = (e) => {
				let t = _.get(e.source);
				return t || _.set(e.source, t = new Map(p(e.source).map((e, t) => [e, t]))), e.id ? t.get(e.id) : 0;
			}, x = 0, w = o, j = -1;
			if (l) o = w = xn.source, x = xn.first, j = xn.last;
			else if (o >= 0) {
				let e = h(n[o].blocks, r[o].blocks);
				x = m(r[o].blocks.slice(0, e));
				for (let t = r.length - 1; t >= o; t--) if (a(n[t].blocks, r[t].blocks)) {
					w = t;
					let i = t === o ? e : h(n[t].blocks, r[t].blocks), a = g(n[t].blocks, r[t].blocks, i);
					j = m(r[t].blocks) - m(r[t].blocks.slice(r[t].blocks.length - a)) - 1;
					break;
				}
			}
			let M = -1;
			if (s >= 0) {
				let e = _n[s], t = r[s].blocks, n = g(e, t, h(e, t));
				M = m(t) - m(t.slice(t.length - n)) - 1;
			}
			let N = (e, t, n) => {
				if (e.source !== t) return e.source > t;
				let r = b(e);
				return r != null && r > n;
			}, te = c < 0 ? Q.length : c, P = Q.slice(0, te).map((e, t) => ({
				page: t,
				info: e.info
			}));
			c >= 0 && vn && P.push({
				page: c,
				info: vn
			});
			let F;
			if (o < 0) F = P[P.length - 1];
			else {
				let e = P.filter((e) => e.info.cursor.source === o), t = -1;
				for (let n = 0; n < e.length; n++) {
					let r = b(e[n].info.cursor);
					if (r == null || r >= x) break;
					t = n;
				}
				if (t >= 0) {
					let n = b(e[t].info.cursor);
					!Array.from(f[o].querySelector(":scope > .doc-body")?.children ?? []).slice(n, x).some((e) => e.dataset.docKeepNext !== "true") && t > 0 && t--, F = e[t];
				} else F = e.length ? {
					page: e[0].page,
					info: {
						...e[0].info,
						cursor: {
							source: o,
							id: p(o)[0] ?? "",
							kind: "fresh",
							part: 0
						}
					}
				} : P[P.length - 1];
			}
			if (!F || c >= 0 && F.page > c) return pn();
			let I = r.some((e) => e.header?.evenPage?.length || e.footer?.evenPage?.length);
			o >= 0 && !l && (xn = {
				source: o,
				first: x,
				last: Math.max(x, j)
			}), E.value = !0, D.value = !1, hn = r, gn = i;
			let L = () => u !== A, R = performance.now(), z = F.page, ne = /* @__PURE__ */ new Map();
			for (let e = Q.length - 1; e >= Math.max(z, c); e--) ne.set(En(Q[e].info.cursor), e);
			let re = /* @__PURE__ */ new Map([[z, F.info]]), ie = /* @__PURE__ */ new Map();
			for (let e of Q) {
				let t = e.info.cursor;
				if (t.kind !== "text") continue;
				let n = ie.get(t.id) ?? [];
				n.push(t.part), ie.set(t.id, n);
			}
			let B = !0, V = 0, ae, oe = !1, H = { cancel() {
				if (oe) return;
				oe = !0;
				let e = z + V;
				for (let t = e; t < Q.length; t++) Q[t].stale = !0;
				vn = e < Q.length ? re.get(e) : void 0, e < Q.length && !vn && (mn = !1);
			} };
			Sn = H;
			let se = window.document.createElement("div");
			S.value.append(se);
			try {
				await Ge(f.map((e, t) => ({
					element: e,
					first: r[t].first,
					restart: r[t].restart
				})), se, L, () => {}, async (t) => {
					if (L() || !C.value) return;
					let n = ln(), r = n?.scrollTop ?? 0, i = z + V;
					t.papers.length && y("pages-changing"), t.papers.forEach((n, r) => {
						let i = z + V, a = Nn(n), o = d.children[i];
						o ? o.replaceWith(a) : d.append(a), J.splice(i, +(i < Q.length), [{
							root: a,
							found: a.querySelectorAll(e)
						}]), Q[i] = {
							info: t.infos[r],
							stale: !1
						}, xe(i), V++;
					}), n && (n.scrollTop = r), t.papers.length && y("pages-changed", {
						from: i,
						count: t.papers.length
					});
				}, {
					resume: F,
					urgent: () => B,
					splitHint: (e, t) => {
						let n = ie.get(e)?.find((e) => e > t);
						return n == null ? void 0 : n - t;
					},
					stop: (e, t) => {
						re.set(e, t), B && (o < 0 || performance.now() - R > 400 || N(t.cursor, w, j)) && (B = !1);
						let n = ne.get(En(t.cursor));
						return n == null || n < e || Q[n].info.first !== t.first || s >= 0 && !N(t.cursor, s, M) || (t.number - Q[n].info.number) % 2 != 0 && I ? !1 : (ae = {
							at: e,
							slot: n,
							number: t.number
						}, !0);
					}
				});
				let t = z + V;
				if (L()) {
					H.cancel();
					return;
				}
				oe = !0, Sn === H && (Sn = void 0);
				let n = ae;
				if (n) {
					let e = n.slot - n.at;
					if (e > 0) {
						J.splice(n.at, e, []);
						for (let t = 0; t < e; t++) d.children[n.at]?.remove();
						Q.splice(n.at, e);
					}
					let t = n.number - Q[n.at].info.number;
					if (e !== 0 || t !== 0) for (let e = n.at; e < Q.length; e++) {
						let i = Q[e].info;
						e > n.at && i.first && r[i.cursor.source]?.restart != null && (t = 0), t && (Q[e] = {
							...Q[e],
							info: {
								...i,
								number: i.number + t
							}
						});
						let a = d.children[e]?.firstElementChild;
						a && We(a, e, Q[e].info.number);
					}
				} else if (Q.length > t) {
					for (J.splice(t, Q.length - t, []); d.children.length > t;) d.lastElementChild?.remove();
					Q.length = t;
				}
				Pn(), Y.clear(), Se(), T.value = Q.length, ee.value = Q.length, k.value = Math.min(k.value, Math.max(0, Q.length - 1)), D.value = !0, E.value = !1, kn(), y("pagination", {
					pages: Q.length,
					complete: !0,
					warnings: O.value
				}), Ee();
			} catch (e) {
				if (L()) {
					H.cancel();
					return;
				}
				return oe = !0, Sn === H && (Sn = void 0), console.warn("[DocsPreview] 增量续排失败，改为整篇重排：", e), se.remove(), pn();
			} finally {
				se.remove();
			}
		}
		function In() {
			$.value || (v.editable && mn && xn ? Fn(!0) : pn());
		}
		function Ln(e, t, n = "start") {
			if ($.value) return hr(e, t, n);
			let r = e;
			for (; r && !(r instanceof HTMLElement && r.hasAttribute("data-doc-text"));) r = r.parentNode;
			if (!r || !C.value?.contains(r)) return;
			let i = J.fragmentOf(r);
			if (!i || i.kind !== "text" || i.role !== "body") return;
			let a = d(J.textMap(i), i.element, e, t, n), o = x.value.nodes.get(i.node);
			if (a != null && o?.kind === "text" && o.shift != null) return {
				node: i.node,
				offset: Math.max(0, a - o.shift)
			};
		}
		function Rn(e, t, n) {
			let r = C.value;
			if (!r || !r.contains(e)) return;
			let i = (e) => e instanceof HTMLElement && e.hasAttribute("data-doc-text") && !e.closest(".doc-running,[data-preview-repeated]") && e.tagName !== "PRE", a = window.document.createTreeWalker(r, NodeFilter.SHOW_ELEMENT), o = e.childNodes[n > 0 ? t : t - 1];
			if (n > 0) {
				let t = o ?? null;
				if (!t) {
					let n = e;
					for (; n && n !== r && !n.nextSibling;) n = n.parentNode;
					t = n && n !== r ? n.nextSibling : null;
				}
				for (; t;) {
					if (i(t)) return t;
					a.currentNode = t, t = t.nodeType === Node.ELEMENT_NODE ? a.nextNode() : zn(t, r);
				}
				return;
			}
			let s = o ?? null;
			if (s) {
				let e = s instanceof HTMLElement ? Array.from(s.querySelectorAll("[data-doc-text]")).filter(i).pop() : void 0;
				if (e) return e;
				if (i(s)) return s;
			} else s = e;
			a.currentNode = s.nodeType === Node.ELEMENT_NODE ? s : s.parentNode ?? r;
			for (let t = a.previousNode(); t; t = a.previousNode()) if (i(t) && !t.contains(e)) return t;
		}
		function zn(e, t) {
			let n = e;
			for (; n && n !== t && !n.nextSibling;) n = n.parentNode;
			return n && n !== t ? n.nextSibling : null;
		}
		function Bn(e, t, n = "start") {
			let r = Ln(e, t, n);
			if (r) return r;
			let i = Rn(e, t, 1);
			if (i) {
				let e = Ln(i, 0, "start");
				if (e) return e;
			}
			let a = Rn(e, t, -1);
			return a ? Ln(a, a.childNodes.length, "end") : void 0;
		}
		function Vn(e) {
			if ($.value) return _r(e);
			let t = x.value.nodes.get(e.node);
			if (t?.kind !== "text" || t.shift == null) return;
			let n = e.offset + t.shift, r = J.resolveText(e.node, n, n).parts[0];
			if (!r || !J.isCurrent(r.fragment)) return;
			let i = a(J.textMap(r.fragment), n, n);
			if (i) return {
				node: i.start.node,
				offset: i.start.offset
			};
			let o = r.fragment.element, s = o.querySelector(":scope > br[data-doc-empty-line]");
			return {
				node: o,
				offset: s ? Array.prototype.indexOf.call(o.childNodes, s) : o.childNodes.length
			};
		}
		function Hn(e) {
			if ($.value) return yr(e);
			let t = x.value.nodes.get(e.node);
			if (t?.kind !== "text" || t.shift == null) return;
			let n = e.offset + t.shift;
			return J.resolveText(e.node, n, n).parts[0]?.fragment.page;
		}
		function Un(e) {
			if ($.value) return br(e);
			k.value = Math.max(0, Math.min(e, T.value - 1)), un();
		}
		pe([
			() => v.context,
			() => v.embeddedFonts,
			() => v.fontRevision,
			() => v.editable
		], () => {
			$.value ? v.editable ? Dr() : Or() : pn();
		}, { flush: "post" }), pe(() => v.model, () => {
			$.value ? v.editable ? Dr() : Or() : v.editable ? Fn() : pn();
		}, { flush: "post" }), pe(Pt, fn, { flush: "post" }), se(() => {
			$.value ? Or() : pn(), $e = ln(), $e?.addEventListener("scroll", et, { passive: !0 });
			for (let e of [
				"wheel",
				"touchstart",
				"pointerdown"
			]) $e?.addEventListener(e, z, { passive: !0 });
			$e?.addEventListener("keydown", tt), document.addEventListener("selectionchange", Ve), document.fonts.addEventListener("loadingdone", In), Ze = new ResizeObserver((e) => {
				let t = e[0]?.contentRect.width ?? 0;
				t <= 0 ? (Qe = !0, ++A, $.value || (E.value = !1)) : (Je.value = t, Qe && ($.value ? Or() : pn()));
			}), qe.value && Ze.observe(qe.value);
		}), ce(() => {
			A++, z(), $e?.removeEventListener("scroll", et);
			for (let e of [
				"wheel",
				"touchstart",
				"pointerdown"
			]) $e?.removeEventListener(e, z);
			$e?.removeEventListener("keydown", tt), document.removeEventListener("selectionchange", Ve), cancelAnimationFrame(Re), De(), Ze?.disconnect(), or?.disconnect(), document.fonts.removeEventListener("loadingdone", In);
		});
		let Wn = typeof CSS < "u" && CSS.supports("column-wrap", "wrap") && CSS.supports("column-height", "1px"), $ = P(() => v.engine !== "paged" && (Wn || v.engine === "flow")), Gn = W([]), Kn = W([]), qn = W(0), Jn = le(/* @__PURE__ */ new Map());
		function Yn(e, t) {
			let n = Mt(e.page), r = Z(n.width) ?? 794, i = Z(n.height) ?? 1123, a = e.page.margins, o = Z(a.left + (a.gutter ?? 0)) ?? 0, s = Z(a.right) ?? 0, c = Math.max(Z(a.top) ?? 0, Kn.value[t]?.top ?? 0), l = Math.max(Z(a.bottom) ?? 0, Kn.value[t]?.bottom ?? 0), u = Xn(Math.max(24, i - c - l)), d = Xn(i + kt);
			return {
				width: r,
				height: i,
				left: o,
				top: c,
				bottom: l,
				lead: Kn.value[t]?.lead ?? 0,
				bodyWidth: Math.max(24, r - o - s),
				bodyHeight: u,
				cramped: i - c - l < 24,
				pitch: d,
				gap: d - u
			};
		}
		let Xn = (e) => Math.round(e * 64) / 64, Zn = P(() => {
			let e = [], t = 0, n = 1;
			return jt.value.forEach((r, i) => {
				r.first && r.restart != null && (n = r.restart), e.push({
					index: t,
					number: n
				});
				let a = Gn.value[i] ?? 1;
				t += a, n += a;
			}), e;
		}), Qn = P(() => jt.value.reduce((e, t, n) => e + (Gn.value[n] ?? 1), 0));
		function $n(e, t) {
			let n = Yn(e, t), r = Gn.value[t] ?? 1;
			return {
				width: `${n.width * Pt.value}px`,
				height: `${(r * n.pitch - kt) * Pt.value}px`
			};
		}
		function er(e, t) {
			let n = Yn(e, t), r = Gn.value[t] ?? 1, i = cn(e);
			return {
				width: `${n.width}px`,
				height: `${r * n.pitch - kt}px`,
				transform: `scale(${Pt.value})`,
				fontFamily: i.fontFamily,
				color: i.color
			};
		}
		function tr(e, t) {
			let n = Yn(e, t);
			return {
				marginLeft: `${n.left}px`,
				width: `${n.bodyWidth}px`,
				paddingTop: `${n.top}px`,
				columns: 1,
				columnFill: "auto",
				columnHeight: `${n.bodyHeight}px`,
				columnWrap: "wrap",
				rowGap: `${n.gap}px`
			};
		}
		function nr(e, t, n) {
			return {
				...cn(e),
				top: `${n * Yn(e, t).pitch}px`
			};
		}
		function rr(e, t, n) {
			return e.first && n === 0 ? "first" : ((Zn.value[t]?.number ?? 1) + n) % 2 == 0 ? "even" : "default";
		}
		function ir(e, t, n) {
			let r = e[t];
			return n === "first" && r?.firstPage ? r.firstPage : n === "even" && r?.evenPage ? r.evenPage : r?.blocks ?? (nt.value ? [] : v.context.docs[t] ?? []);
		}
		let ar = /* @__PURE__ */ new Map(), or;
		function sr() {
			if (!qe.value?.getClientRects().length) return;
			let e = [], t = [];
			jt.value.forEach((n, r) => {
				let i = ar.get(r), a = Yn(n, r);
				e[r] = i ? Math.max(1, Math.round((i.offsetHeight - a.top + a.gap) / a.pitch)) : Gn.value[r] ?? 1;
				let o = (e, t) => {
					let n = e?.querySelector(`:scope > .doc-${t}`);
					return n?.children.length ? parseFloat(getComputedStyle(n)[t === "header" ? "top" : "bottom"]) + n.offsetHeight : 0;
				}, s = Array.from(i?.parentElement?.querySelectorAll(".doc-sheet") ?? []).slice(0, 3), c = s.length > 1 ? s.slice(1) : s, l = Z(n.page.margins.top) ?? 0, u = Math.max(0, ...c.map((e) => o(e, "header"))), d = o(s[0], "header");
				t[r] = {
					top: u,
					bottom: Math.max(0, ...s.map((e) => o(e, "footer"))),
					lead: s.length > 1 ? Math.max(0, Math.max(l, d) - Math.max(l, u)) : 0
				};
			});
			let n = (e, t) => JSON.stringify(e) === JSON.stringify(t);
			n(t, Kn.value) || (Kn.value = t);
			let r = !n(e, Gn.value);
			r && (Gn.value = e, T.value = e.reduce((e, t) => e + t, 0), k.value = Math.min(k.value, Math.max(0, T.value - 1))), ur(), r && (D.value && (O.value = lr()), y("pagination", {
				pages: T.value,
				complete: D.value,
				warnings: O.value
			}), Er());
		}
		function cr(e) {
			return [...e.sections.some((e) => e.breakKind && e.breakKind !== "next_page") ? ["连续节及奇偶页节暂按新页展示，未模拟同页节或补空白页。"] : [], ...v.model.footnotes?.length ? ["脚注目前集中在文档尾部，未参与每页脚注布局。"] : []];
		}
		function lr() {
			let e = [];
			return jt.value.some((e) => (e.page.columns ?? 1) > 1) && e.push("多栏当前按单栏分页展示；未声称还原源栏间布局。"), jt.value.some((e, t) => Yn(e, t).cramped) && e.push("页眉页脚与边距占用过高，可用正文高度不足。"), jt.value.some((e, t) => {
				let n = ar.get(t), r = Yn(e, t).bodyHeight + 1;
				return Array.from(n?.querySelectorAll("img, svg") ?? []).some((e) => e.getBoundingClientRect().height / Pt.value > r);
			}) && e.push("有图片或不可拆分块高于一页；内容保留，尚需调整原始版式。"), [...e, ...cr(b.value)];
		}
		function ur() {
			let e = C.value;
			if (!e) return;
			let t = String(Qn.value);
			for (let n of Array.from(e.querySelectorAll(".doc-flow__body :is([data-doc-field=\"page_number\"],[data-doc-field=\"num_pages\"])"))) {
				let e = t;
				if (n.dataset.docField === "page_number") {
					let t = vr(n, n.getBoundingClientRect().top + 1);
					if (t == null) continue;
					let r = Number(n.closest(".doc-flow")?.dataset.flowSource);
					e = String((Zn.value[r]?.number ?? 1) + t - (Zn.value[r]?.index ?? 0));
				}
				n.textContent !== e && (n.textContent = e);
			}
		}
		function dr(e, t) {
			let n = ar.get(t);
			n !== e && (n && or?.unobserve(n), e instanceof HTMLElement ? (ar.set(t, e), or ??= new ResizeObserver(sr), or.observe(e)) : ar.delete(t));
		}
		function fr(e) {
			if (!v.editable) return;
			let t = (e) => {
				e.getAttribute("contenteditable") !== "false" && e.setAttribute("contenteditable", "false");
			}, n = e.component?.subTree, r = n?.el ?? e.el, i = n?.anchor ?? r;
			for (let e = r; e; e = e.nextSibling) {
				if (e instanceof HTMLElement) {
					e.matches(Ot) && t(e);
					for (let n of Array.from(e.querySelectorAll(Ot))) t(n);
				}
				if (e === i) break;
			}
		}
		let pr = (e, t) => {
			let n = CSS.escape(e);
			return `${t} :is([data-node-id="${n}"],[data-row-id="${n}"],[data-cell-id="${n}"],[data-item-id="${n}"])`;
		};
		function mr(e, t = !1) {
			return C.value?.querySelector(pr(e, ".doc-flow__body")) ?? (t ? w.value?.querySelector(pr(e, "")) : void 0) ?? void 0;
		}
		function hr(e, t, n) {
			let r = e;
			for (; r && !(r instanceof HTMLElement && r.hasAttribute("data-doc-text"));) r = r.parentNode;
			if (!(r instanceof HTMLElement) || !r.closest(".doc-flow__body")) return;
			let i = r.dataset.nodeId ?? "", a = x.value.nodes.get(i);
			if (a?.kind !== "text" || a.shift == null) return;
			let o = d(l(r), r, e, t, n);
			return o == null ? void 0 : {
				node: i,
				offset: Math.max(0, o - a.shift)
			};
		}
		function gr(e, t, n, r = !1) {
			let i = mr(e, r);
			if (i?.hasAttribute("data-doc-text")) return {
				element: i,
				points: X(l(i), t, n)
			};
		}
		function _r(e) {
			let t = x.value.nodes.get(e.node);
			if (t?.kind !== "text" || t.shift == null) return;
			let n = e.offset + t.shift, r = gr(e.node, n, n);
			if (!r) return;
			if (r.points) return {
				node: r.points.startContainer,
				offset: r.points.startOffset
			};
			let i = r.element.querySelector(":scope > br[data-doc-empty-line]");
			return {
				node: r.element,
				offset: i ? Array.prototype.indexOf.call(r.element.childNodes, i) : r.element.childNodes.length
			};
		}
		function vr(e, t) {
			let n = e.closest(".doc-flow"), r = Number(n?.dataset.flowSource), i = jt.value[r];
			if (!n || !i) return;
			let a = (t - n.getBoundingClientRect().top) / Pt.value, o = Math.floor(a / Yn(i, r).pitch);
			return (Zn.value[r]?.index ?? 0) + Math.max(0, Math.min((Gn.value[r] ?? 1) - 1, o));
		}
		function yr(e) {
			let t = _r(e);
			if (!t) return;
			let n = window.document.createRange();
			n.setStart(t.node, t.offset), n.collapse(!0);
			let r = t.node instanceof Element ? t.node : t.node.parentElement, i = n.getClientRects()[0] ?? r?.getBoundingClientRect();
			return r && i ? vr(r, i.top + i.height / 2) : void 0;
		}
		function br(e) {
			let t = ln(), n = Zn.value, r = n.length - 1;
			for (; r > 0 && n[r].index > e;) r--;
			let i = C.value?.querySelector(`.doc-flow[data-flow-source="${r}"]`), a = jt.value[r];
			if (!t || !i || !a) return;
			let o = Math.max(0, Math.min((Gn.value[r] ?? 1) - 1, e - n[r].index));
			t.scrollTop += i.getBoundingClientRect().top + o * Yn(a, r).pitch * Pt.value - t.getBoundingClientRect().top - t.clientTop - (v.compact ? 20 : 10);
		}
		function xr(e) {
			let t = e.commonAncestorContainer, n = (t instanceof Element ? t : t.parentElement) ?? qe.value, r = n.closest("[data-doc-text]"), i = r ? [r] : Array.from(n.querySelectorAll("[data-doc-text]")), a = [];
			for (let t of i) {
				if (!qe.value?.contains(t) || !e.intersectsNode(t)) continue;
				let n = t.dataset.nodeId;
				if (!n) continue;
				let r = t, i = l(r), o = t.contains(e.startContainer) ? d(i, r, e.startContainer, e.startOffset, "start") : i.start, s = t.contains(e.endContainer) ? d(i, r, e.endContainer, e.endOffset, "end") : i.end, c = t.closest(".doc-running") ? "running" : t.closest(".doc-notes") ? "note" : "body";
				o != null && s != null && s > o && a.push({
					node: n,
					start: o,
					end: s,
					role: c
				});
			}
			return m(a, x.value, v.selectionOffsetUnit ?? "scalar");
		}
		function Sr(e) {
			return e.every((e) => e.text ? !!gr(e.node, e.start, e.end, !0)?.points : e.targets.some((e) => !!mr(e, !0)));
		}
		function Cr(e) {
			for (let [t, n] of ve) for (let r of n) {
				if (e != null && r.key !== e) continue;
				if (!r.range.text) {
					let e = mr(t, !0);
					e && Y.addElement(r.key, r.tone, e);
					continue;
				}
				let n = gr(t, r.range.start, r.range.end, !0)?.points;
				n && r.range.end > r.range.start && Y.addRange(r.key, r.tone, new StaticRange(n));
			}
		}
		function wr(e) {
			let t = e[0];
			if (t.text) {
				let n = gr(t.node, t.start, t.end, !0);
				return n ? () => {
					Ce(e), Ne(n.element, () => {
						if (!n.points) return;
						let e = window.document.createRange();
						e.setStart(n.points.startContainer, n.points.startOffset), e.setEnd(n.points.endContainer, n.points.endOffset);
						let t = e.getClientRects()[0] ?? e.getBoundingClientRect();
						return t.width || t.height ? t : void 0;
					});
				} : "missing";
			}
			let n = t.targets.map((e) => mr(e, !0)).find(Boolean);
			return n ? () => {
				Ce(e), Ne(n);
			} : "missing";
		}
		let Tr = /* @__PURE__ */ new WeakMap();
		function Er() {
			let e = C.value;
			if (!e) return;
			let t = /* @__PURE__ */ new Map(), n = (e, n) => {
				let r = e.closest(".doc-flow");
				if (!r) return n;
				let i = t.get(r);
				return i ?? t.set(r, i = r.getBoundingClientRect().top), `${n}#${Array.from(e.getClientRects(), (e) => `${Math.round(e.top - i)}:${Math.round(e.height)}`).join()}`;
			};
			for (let t of Array.from(e.querySelectorAll(".doc-flow__body table"))) {
				let e = t.tBodies[0];
				if (!e) continue;
				let r = Array.from(e.rows), i = (e) => e.dataset.previewRepeated != null, a = r.filter(i), o = r.filter((e) => e.dataset.previewHeader === "true" && !i(e));
				if (!o.length || t.getClientRects().length < 2 && !a.length) {
					for (let e of a) e.remove();
					continue;
				}
				let s = o.map((e) => `${e.cells.length}:${e.textContent}`).join("|");
				if (Tr.get(t) === n(t, s)) continue;
				let c = (e) => vr(e, e.getBoundingClientRect().top + 1) ?? 0, l = a.every((e) => e.dataset.previewSignature === s), u = -1;
				for (let e = 0; e < r.length && l; e++) {
					let t = r[e];
					if (i(t)) continue;
					let n = c(t), a = r.slice(Math.max(0, e - o.length), e), s = a.length === o.length && a.every(i);
					l = u >= 0 && n > u && t.dataset.previewHeader !== "true" ? s && c(a[0]) === n : !(e > 0 && i(r[e - 1])), u = n;
				}
				if (l) Tr.set(t, n(t, s));
				else {
					for (let e of a) e.remove();
					u = -1;
					for (let t of Array.from(e.rows)) {
						let n = c(t);
						if (u < 0 || n <= u || t.dataset.previewHeader === "true") u = n;
						else {
							for (let n of o) {
								let r = n.cloneNode(!0);
								r.dataset.previewRepeated = "true", r.dataset.previewSignature = s, r.setAttribute("contenteditable", "false"), r.setAttribute("aria-hidden", "true");
								for (let e of [r, ...Array.from(r.querySelectorAll("*"))]) for (let t of [
									"data-row-id",
									"data-cell-id",
									"data-node-id",
									"data-doc-text",
									"id"
								]) e.removeAttribute(t);
								e.insertBefore(r, t);
							}
							u = c(t);
						}
					}
					Tr.set(t, n(t, s));
				}
			}
		}
		function Dr() {
			Er(), (ge.size || _e) && (Y.clear(), Cr()), y("pages-changed", {
				from: 0,
				count: 0
			});
		}
		async function Or() {
			let e = ++A, t = b.value;
			if (v.editable) {
				j = t, E.value = !1, D.value = !0, sr(), Dr(), An();
				return;
			}
			let n = j === t;
			if (j = t, E.value = !0, D.value = !1, !n) {
				z(), De(), k.value = 0, O.value = [];
				let e = ln();
				e && (e.scrollTop = 0);
			}
			sr(), Dr(), y("pagination", {
				pages: T.value,
				complete: !1
			}), await ae(), e === A && (qe.value?.getClientRects().length ? (Qe = !1, await Promise.race([window.document.fonts.ready, new Promise((e) => setTimeout(e, 900))]), e === A && C.value && (await Promise.allSettled(Array.from(C.value.querySelectorAll("img"), (e) => e.decode())), e === A && (qe.value?.getClientRects().length ? (D.value = !0, E.value = !1, sr(), Er(), O.value = lr(), y("pagination", {
				pages: T.value,
				complete: !0,
				warnings: O.value
			}), await ae(), e === A && (re(), Ee(), An())) : Qe = !0))) : Qe = !0);
		}
		function kr(e) {
			if (!$.value) return void pn();
			if (!e?.length) qn.value++;
			else for (let t of e) Jn.set(t, (Jn.get(t) ?? 0) + 1);
		}
		let Ar = (e) => `${e}:${Jn.get(e) ?? 0}`;
		pe([
			Gn,
			qn,
			() => Jn.size,
			() => [...Jn.values()].join()
		], () => {
			$.value && (sr(), Dr());
		}, { flush: "post" });
		let jr = (e) => {
			let t = At;
			At = e.number == null ? void 0 : {
				number: e.number,
				total: e.total ?? 0
			}, v.fontRevision;
			try {
				return on(e.value, e.page);
			} finally {
				At = t;
			}
		};
		return (e, t) => (U(), L("section", {
			ref_key: "host",
			ref: qe,
			class: oe(["doc-preview", {
				"doc-preview--compact": f.compact,
				"doc-preview--editable": f.editable
			}]),
			"data-testid": "docs-preview",
			"aria-label": "文档可读预览"
		}, [
			f.bare ? I("v-if", !0) : (U(), F(te, {
				key: 0,
				to: f.controlsTarget ?? "body",
				disabled: !f.controlsTarget
			}, [R("div", st, [
				t[5] ||= R("strong", null, "文档预览", -1),
				R("label", null, [t[3] ||= ne("缩放", -1), me(R("select", {
					class: "mo-select mo-select-sm",
					"onUpdate:modelValue": t[0] ||= (e) => Ye.value = e,
					"aria-label": "文档预览缩放"
				}, [...t[2] ||= [
					R("option", { value: "fit" }, "适应宽度", -1),
					R("option", { value: "1" }, "100%", -1),
					R("option", { value: "0.75" }, "75%", -1),
					R("option", { value: "1.25" }, "125%", -1)
				]], 512), [[fe, Ye.value]])]),
				T.value > 1 ? (U(), L("label", ct, [t[4] ||= ne("跳到", -1), me(R("select", {
					class: "mo-select mo-select-sm",
					"aria-label": "跳转文档页",
					"onUpdate:modelValue": t[1] ||= (e) => k.value = e,
					onChange: un
				}, [(U(!0), L(N, null, G(T.value, (e) => (U(), L("option", {
					key: e,
					value: e - 1
				}, "第 " + K(e) + " 页", 9, lt))), 128))], 544), [[
					fe,
					k.value,
					void 0,
					{ number: !0 }
				]])])) : I("v-if", !0),
				R("span", null, K(T.value) + " 个预览页", 1),
				R("button", {
					class: "mo-btn mo-btn-sm",
					type: "button",
					disabled: E.value,
					onClick: pn
				}, "重新分页", 8, ut),
				ue(e.$slots, "controls", {}, void 0, !0)
			])], 8, ["to", "disabled"])),
			!f.compact && !f.bare ? (U(), L("p", dt, "按纸张尺寸、边距及页眉页脚可用高度测量自动分页；段落可续页，普通表格按行跨页。浏览器与Word的字体度量及断行可能不同，不宣称Word像素级排版。源文件未支持项见预检。浏览器使用本机字体，缺少指定字体时会回退。")) : I("v-if", !0),
			nt.value && !f.compact && !f.bare ? (U(), L("p", ft, "源主题已转换；不会凭空把主题默认页眉、页脚或目录当作原文件内容。")) : I("v-if", !0),
			(U(!0), L(N, null, G(f.bare ? [] : O.value, (e) => (U(), L("p", {
				key: e,
				role: "alert",
				class: "doc-pagination-warning"
			}, K(e), 1))), 128)),
			$.value ? (U(), L("div", {
				key: 3,
				ref_key: "visibleHost",
				ref: C,
				class: "doc-pages doc-pages--flow",
				"aria-busy": E.value,
				"data-pagination-complete": D.value,
				"data-engine": "flow",
				onClick: q,
				onWheelPassive: z
			}, [(U(!0), L(N, null, G(jt.value, (e, t) => (U(), L("div", {
				key: `${e.section}-${t}-${qn.value}`,
				class: "doc-flow-wrap",
				style: H($n(e, t))
			}, [R("div", {
				class: "doc-flow",
				"data-flow-source": t,
				style: H(er(e, t))
			}, [R("div", {
				class: "doc-flow__sheets",
				contenteditable: f.editable ? "false" : void 0,
				"aria-hidden": "true"
			}, [(U(!0), L(N, null, G(Gn.value[t] ?? 1, (n) => (U(), L("article", {
				key: n,
				class: "doc-paper doc-sheet",
				"data-testid": "doc-page",
				"data-page-number": (Zn.value[t]?.number ?? 1) + n - 1,
				style: H(nr(e, t, n - 1))
			}, [R("div", _t, "预览 " + K((Zn.value[t]?.index ?? 0) + n), 1), (U(), L(N, null, G(["header", "footer"], (r) => (U(), L(N, { key: r }, [ir(e, r, rr(e, t, n - 1)).length ? (U(), L("div", {
				key: 0,
				class: oe(["doc-running", `doc-${r}`]),
				"data-testid": `doc-${r}`
			}, [(U(!0), L(N, null, G(ir(e, r, rr(e, t, n - 1)), (r) => (U(), F(jr, {
				key: r.id,
				value: r,
				page: t,
				layout: e.page,
				number: (Zn.value[t]?.number ?? 1) + n - 1,
				total: Qn.value
			}, null, 8, [
				"value",
				"page",
				"layout",
				"number",
				"total"
			]))), 128))], 10, vt)) : I("v-if", !0)], 64))), 64))], 12, gt))), 128))], 8, ht), R("div", {
				ref_for: !0,
				ref: (e) => dr(e, t),
				class: "doc-body doc-flow__body",
				"data-testid": "doc-body",
				style: H(tr(e, t))
			}, [Kn.value[t]?.lead ? (U(), L("div", {
				key: 0,
				class: "doc-flow__lead",
				"aria-hidden": "true",
				contenteditable: f.editable ? "false" : void 0,
				style: H({ height: `${Kn.value[t].lead}px` })
			}, null, 12, yt)) : I("v-if", !0), (U(!0), L(N, null, G(e.blocks, (n) => (U(), F(jr, {
				key: Ar(n.id),
				value: n,
				page: t,
				layout: e.page,
				onVnodeMounted: fr,
				onVnodeUpdated: fr
			}, null, 8, [
				"value",
				"page",
				"layout"
			]))), 128))], 4)], 12, mt)], 4))), 128))], 40, pt)) : (U(), L("div", {
				key: 4,
				ref_key: "visibleHost",
				ref: C,
				class: "doc-pages",
				"aria-busy": E.value,
				"data-pagination-complete": D.value,
				"data-engine": "paged",
				onClick: q,
				onWheelPassive: z
			}, null, 40, bt)),
			E.value && !f.bare ? (U(), L("p", xt, [t[6] ||= ne("正在分页…", -1), ee.value ? (U(), L(N, { key: 0 }, [ne("已完成 " + K(ee.value) + " 页", 1)], 64)) : I("v-if", !0)])) : I("v-if", !0),
			$.value ? I("v-if", !0) : (U(), L("div", {
				key: 6,
				ref_key: "sourceHost",
				ref: S,
				class: "doc-measure",
				"aria-hidden": "true",
				inert: ""
			}, [(U(!0), L(N, null, G(jt.value, (e, t) => (U(), L("article", {
				key: `${e.section}-${t}-${f.fontRevision ?? 0}`,
				class: "doc-paper doc-source",
				style: H(cn(e))
			}, [
				(U(), L(N, null, G([
					"default",
					"first",
					"even"
				], (n) => R("div", {
					key: "h" + n,
					class: "doc-running doc-header",
					"data-running": "header-" + n
				}, [(U(!0), L(N, null, G(n === "first" && e.header?.firstPage ? e.header.firstPage : n === "even" && e.header?.evenPage ? e.header.evenPage : e.header?.blocks ?? (nt.value ? [] : f.context.docs.header ?? []), (n) => (U(), F(jr, {
					key: n.id,
					value: n,
					page: t,
					layout: e.page
				}, null, 8, [
					"value",
					"page",
					"layout"
				]))), 128))], 8, St)), 64)),
				R("div", {
					class: "doc-body",
					style: H({ columnCount: e.page.columns ?? 1 })
				}, [(U(!0), L(N, null, G(e.blocks, (n) => (U(), F(jr, {
					key: n.id,
					value: n,
					page: t,
					layout: e.page
				}, null, 8, [
					"value",
					"page",
					"layout"
				]))), 128))], 4),
				(U(), L(N, null, G([
					"default",
					"first",
					"even"
				], (n) => R("div", {
					key: "f" + n,
					class: "doc-running doc-footer",
					"data-running": "footer-" + n
				}, [(U(!0), L(N, null, G(n === "first" && e.footer?.firstPage ? e.footer.firstPage : n === "even" && e.footer?.evenPage ? e.footer.evenPage : e.footer?.blocks ?? (nt.value ? [] : f.context.docs.footer ?? []), (n) => (U(), F(jr, {
					key: n.id,
					value: n,
					page: t,
					layout: e.page
				}, null, 8, [
					"value",
					"page",
					"layout"
				]))), 128))], 8, Ct)), 64))
			], 4))), 128))], 512)),
			f.model.footnotes?.length ? (U(), L("section", {
				key: 7,
				ref_key: "notesHost",
				ref: w,
				class: "doc-notes"
			}, [t[7] ||= R("h3", null, "脚注", -1), (U(!0), L(N, null, G(f.model.footnotes, (e) => (U(), L("div", {
				key: e.id,
				id: `doc-note-${encodeURIComponent(e.id)}`
			}, [R("strong", null, "[" + K(e.id) + "]", 1), (U(!0), L(N, null, G(e.blocks, (e) => (U(), F(jr, {
				key: e.id,
				value: e,
				page: 0
			}, null, 8, ["value"]))), 128))], 8, wt))), 128))], 512)) : I("v-if", !0)
		], 2));
	}
}), [["__scopeId", "data-v-cbf2f0b3"]]), jt = {
	class: "mo-docs-editor__live",
	role: "status",
	"aria-live": "polite",
	"aria-atomic": "true"
}, Mt = "protected", Nt = /* @__PURE__ */ ie({
	__name: "DocsEditor",
	props: {
		model: {},
		context: {},
		readOnly: { type: Boolean },
		zoom: {},
		protectedRanges: {},
		overlays: {},
		showProtected: {
			type: Boolean,
			default: !0
		},
		protectFormatting: {
			type: Boolean,
			default: !0
		},
		actor: {},
		constraints: {},
		beforeTransaction: {},
		paste: {},
		spellcheck: { type: Boolean },
		engine: {},
		ariaLabel: {},
		embeddedFonts: {},
		fontRevision: {}
	},
	emits: [
		"transaction",
		"update:model",
		"selection-change",
		"blocked",
		"pagination",
		"state-change"
	],
	setup(e, { expose: t, emit: n }) {
		let r = e, i = n, a = W(), o = W(), s = de(r.model), c = W(""), l = W(!1), u = W(!1), d = W(0), f = W(!1), p = W([]), m = W(0), h = r.model, g = {
			inputMs: [],
			settleMs: []
		}, _ = 0, y = 0;
		function b(e, t) {
			e.push(Math.round(t * 100) / 100), e.length > 500 && e.shift();
		}
		function j() {
			return (r.constraints ?? r.context.constraints) === "controlled" ? "controlled" : void 0;
		}
		let M = new O({
			doc: r.model,
			actor: r.actor,
			constraints: j(),
			readOnly: r.readOnly,
			protectFormatting: r.protectFormatting,
			beforeTransaction: (e, t) => r.beforeTransaction?.(e, t),
			onTransaction(e, t) {
				s.value = M.doc, h = M.doc, ie(t), i("update:model", M.doc), i("transaction", e, t), V = !0, H = !0;
				let n = performance.now();
				(!_ || n - _ > 250) && (_ = n), y = _;
			},
			onBlocked(e) {
				c.value = e.kind === "readonly" ? "文档为只读，不能修改。" : e.kind === "host" ? "此修改未被允许。" : e.kind === "constraint" ? "当前主题不允许此格式修改。" : "此处内容受保护，不能修改。", i("blocked", e);
			},
			onState() {
				m.value++;
			}
		});
		r.protectedRanges && M.setProtectedRanges(r.protectedRanges);
		let N = P(() => {
			m.value, d.value;
			let e = M.selection?.focus, t = e ? a.value?.pageOf(e) : void 0;
			return t == null || t < 0 ? 0 : t + 1;
		}), te = P(() => (m.value, {
			format: M.state,
			canUndo: M.canUndo,
			canRedo: M.canRedo,
			dirty: M.dirty,
			readOnly: M.readOnly,
			focused: l.value,
			composing: u.value,
			pages: d.value,
			currentPage: N.value,
			layoutComplete: f.value
		}));
		pe(te, (e) => i("state-change", e), { immediate: !0 });
		function F(e) {
			if (!e) return null;
			let t = S(M.doc), n = C(t, e.anchor, e.focus) <= 0, r = n ? e.anchor : e.focus, i = n ? e.focus : e.anchor, a = t.order.get(r.node), o = t.order.get(i.node);
			if (a == null || o == null) return null;
			let s = [];
			for (let e = a; e <= o; e++) {
				let n = t.texts[e].id, c = Array.from(T(t, n)), l = e === a ? r.offset : 0, u = e === o ? i.offset : c.length;
				(u > l || a === o) && s.push({
					node: n,
					start: l,
					end: u,
					text: c.slice(l, u).join("")
				});
			}
			return {
				anchor: e.anchor,
				focus: e.focus,
				collapsed: r.node === i.node && r.offset === i.offset,
				text: s.map((e) => e.text).join("\n"),
				segments: s
			};
		}
		let I = "null";
		pe(m, () => {
			let e = JSON.stringify(M.selection);
			e !== I && (I = e, i("selection-change", F(M.selection)));
		}), pe(() => r.model, (e) => {
			e !== h && e !== M.doc && (h = e, M.setDoc(e), s.value = e, z = void 0, V = !0);
		}), pe(() => r.readOnly, (e) => {
			M.readOnly = !!e, He(), m.value++;
		}), pe(() => r.protectedRanges, (e) => {
			M.setProtectedRanges(e ?? []), B();
		}), pe(() => [r.overlays, r.showProtected], () => {
			z = void 0, B();
		}), pe(() => [
			r.actor,
			r.constraints,
			r.context.constraints,
			r.protectFormatting
		], () => M.configure({
			actor: r.actor,
			constraints: j(),
			protectFormatting: r.protectFormatting
		}));
		let z, ne = /* @__PURE__ */ new Set();
		function ie(e) {
			z?.length && e.steps.length && (z = z.flatMap((t) => {
				let n = A(t.anchor, e.steps);
				return n ? [{
					...t,
					anchor: n
				}] : [];
			}));
		}
		async function B() {
			let e = a.value;
			if (!e) return;
			z ??= (r.overlays ?? []).map((e) => ({ ...e }));
			let t = [...z];
			if (r.showProtected !== !1) for (let e of M.protected) t.push({
				id: e.id,
				group: Mt,
				anchor: e.anchor,
				tone: "protected"
			});
			let n = new Set(t.map((e) => e.group));
			for (let t of ne) n.has(t) || e.clearHighlights(t);
			ne = n, t.length && e.setHighlights(t);
		}
		let V = !1, H = !1;
		function le() {
			return a.value?.surface();
		}
		function G() {
			let e = le(), t = window.getSelection();
			if (!e || !t?.anchorNode || !t.focusNode || !e.contains(t.anchorNode) || !e.contains(t.focusNode)) return;
			let n = a.value, r = document.createRange();
			r.setStart(t.anchorNode, t.anchorOffset), r.setEnd(t.focusNode, t.focusOffset);
			let i = r.collapsed && !t.isCollapsed, o = n.caretFromDom(t.anchorNode, t.anchorOffset, i ? "end" : "start"), s = t.isCollapsed ? o : n.caretFromDom(t.focusNode, t.focusOffset, i ? "start" : "end");
			return o && s ? {
				anchor: o,
				focus: s
			} : null;
		}
		function ue() {
			if (V) return;
			let e = G();
			e !== void 0 && M.setSelection(e);
		}
		function fe() {
			if (u.value || me || V) return;
			let e = G();
			e !== void 0 && M.setSelection(e);
		}
		let me = !1;
		function q() {
			let e = a.value, t = le(), n = M.selection;
			if (!e || !t || !n) return !0;
			let r = e.domFromPoint(n.anchor), i = e.domFromPoint(n.focus);
			if (!r || !i) return !1;
			let o = window.getSelection();
			if (!o) return !0;
			me = !0;
			try {
				o.setBaseAndExtent(r.node, r.offset, i.node, i.offset);
			} finally {
				me = !1;
			}
			return !0;
		}
		function J() {
			let e = a.value?.scroller(), t = window.getSelection();
			if (!e || !t?.rangeCount || !t.focusNode || !le()?.contains(t.focusNode)) return;
			let n = document.createRange();
			n.setStart(t.focusNode, t.focusOffset), n.collapse(!0);
			let r = n.getClientRects()[0] ?? n.getBoundingClientRect();
			if (!r.height && t.focusNode instanceof Element && (r = t.focusNode.getBoundingClientRect()), !r.height && !r.width) return;
			let i = e.getBoundingClientRect();
			r.top < i.top + 24 ? e.scrollTop -= i.top + 24 - r.top : r.bottom > i.bottom - 24 && (e.scrollTop += r.bottom - (i.bottom - 24));
		}
		function Y() {
			V && !u.value && (!l.value && document.activeElement !== le() ? V = !1 : q() && (V = !1, _ && b(g.inputMs, performance.now() - _), _ = 0, H && J(), H = !1));
		}
		pe(m, () => {
			V && ae(Y);
		});
		let he = !1;
		function ge() {
			if (he = !1, u.value) return;
			let e = le(), t = window.getSelection();
			e && t?.anchorNode && e.contains(t.anchorNode) && (V || ue(), he = !0);
		}
		function _e() {
			if (V) return Y();
			he && !u.value && !q() && (V = !0);
		}
		function ve() {
			V = !1;
		}
		function ye(e) {
			d.value = e.pages, f.value = e.complete, p.value = e.warnings ?? [], e.complete && (Y(), V = !1, B(), y && b(g.settleMs, performance.now() - y), y = 0), i("pagination", {
				pages: e.pages,
				current: N.value,
				complete: e.complete,
				warnings: p.value
			});
		}
		pe(s, () => void ae(B), { flush: "post" });
		function be(e) {
			let t = e.getTargetRanges?.()[0], n = a.value;
			if (!t || !n) return;
			let r = n.caretFromDom(t.startContainer, t.startOffset, "start"), i = n.caretFromDom(t.endContainer, t.endOffset, "end");
			return r && i ? {
				from: r,
				to: i
			} : void 0;
		}
		function X(e) {
			let t = e.inputType;
			if (t !== "insertCompositionText" && t !== "deleteCompositionText" && !(u.value && t !== "insertFromComposition") && (e.preventDefault(), t !== "insertFromComposition")) switch (_ = performance.now(), ue(), t) {
				case "insertText":
					e.data && M.insertText(e.data);
					break;
				case "insertReplacementText":
				case "insertFromYank": {
					let t = e.data ?? e.dataTransfer?.getData("text/plain") ?? "", n = be(e);
					n ? M.replaceRange(n.from, n.to, t, "input") : t && M.insertText(t);
					break;
				}
				case "insertParagraph":
					M.splitBlock();
					break;
				case "insertLineBreak":
					M.exec("insertLineBreak");
					break;
				case "deleteContentBackward":
				case "deleteContent":
					M.deleteBackward("char");
					break;
				case "deleteContentForward":
					M.deleteForward("char");
					break;
				case "deleteWordBackward":
					M.deleteBackward("word");
					break;
				case "deleteWordForward":
					M.deleteForward("word");
					break;
				case "deleteSoftLineBackward":
				case "deleteSoftLineForward":
				case "deleteHardLineBackward":
				case "deleteHardLineForward":
				case "deleteEntireSoftLine": {
					let n = be(e);
					n && M.deleteRange(n.from, n.to, "input", t);
					break;
				}
				case "deleteByCut":
					M.cut();
					break;
				case "historyUndo":
					M.undo();
					break;
				case "historyRedo":
					M.redo();
					break;
				case "formatBold":
					M.exec("bold");
					break;
				case "formatItalic":
					M.exec("italic");
					break;
				case "formatUnderline":
					M.exec("underline");
					break;
				case "formatStrikeThrough":
					M.exec("strike");
					break;
				case "formatSuperscript":
					M.exec("superscript");
					break;
				case "formatSubscript":
					M.exec("subscript");
					break;
				case "formatIndent":
					M.exec("indent");
					break;
				case "formatOutdent":
					M.exec("outdent");
					break;
				case "formatJustifyLeft":
					M.exec("align", "start");
					break;
				case "formatJustifyCenter":
					M.exec("align", "center");
					break;
				case "formatJustifyRight":
					M.exec("align", "end");
					break;
				case "formatJustifyFull": M.exec("align", "justify");
			}
		}
		function xe(e) {
			if (u.value || e.isComposing || /Composition/.test(e.inputType) || performance.now() - we < 50) return;
			let t = Se(M.selection?.anchor.node, M.selection?.focus.node), n = e.inputType === "insertText" && !!e.data && M.insertText(e.data);
			V = !0, n && a.value?.engine() === "flow" ? a.value.restore(t) : n || a.value?.restore();
		}
		function Se(...e) {
			let t = S(M.doc);
			return [...new Set(e.flatMap((e) => t.blocks.get(e ?? "")?.top ?? []))];
		}
		let Ce, we = 0, Te = !1;
		function Ee() {
			Te = V, ue();
			let e = M.selection;
			if (e) {
				let t = S(M.doc);
				Ce = C(t, e.anchor, e.focus) <= 0 ? {
					from: e.anchor,
					to: e.focus
				} : {
					from: e.focus,
					to: e.anchor
				};
			} else Ce = void 0;
			u.value = !0, a.value?.hold(!0);
		}
		function De(e) {
			if (!u.value) return;
			u.value = !1, we = performance.now();
			let t = Ce;
			Ce = void 0;
			let n = e.data ?? "", r = !!t && t.from.node === t.to.node && t.from.offset === t.to.offset, i = Se(t?.from.node, t?.to.node), o = !1;
			t && (n || !r) && (M.setSelection({
				anchor: t.from,
				focus: t.to
			}), o = M.replaceRange(t.from, t.to, n, "composition")), a.value?.hold(!1), Te || !o && (n || !r) ? (V = !0, a.value?.restore(Te ? void 0 : i)) : a.value?.engine() === "flow" && (V = !0, a.value.restore(i));
		}
		let Oe = typeof navigator < "u" && /Mac|iPhone|iPad/.test(navigator.platform), ke = !1;
		function Ae(e) {
			if (e.isComposing || u.value || e.keyCode === 229) return;
			if (performance.now() - we < 30 && e.key === "Enter") {
				e.preventDefault();
				return;
			}
			/^(Arrow|Home|End|Page)/.test(e.key) && (V = !1);
			let t = Oe ? e.metaKey : e.ctrlKey, n = e.key.toLowerCase();
			if (t && !e.altKey) {
				let t = (t) => {
					e.preventDefault(), ue(), t();
				};
				if (n === "z") return t(() => e.shiftKey ? M.redo() : M.undo());
				if (n === "y") return t(() => M.redo());
				if (n === "b") return t(() => M.exec("bold"));
				if (n === "i") return t(() => M.exec("italic"));
				if (n === "u") return t(() => M.exec("underline"));
				if (n === "a") return t(() => {
					M.selectAll() && (V = !0), ae(Y);
				});
				n === "v" && (ke = e.shiftKey);
			} else if (e.key === "Tab" && !e.altKey) {
				if (e.preventDefault(), M.readOnly) return;
				ue(), M.can("table.nextCell") ? M.exec(e.shiftKey ? "table.prevCell" : "table.nextCell") && (V = !0, H = !0, ae(Y)) : e.shiftKey ? M.exec("outdent") : M.exec("insertTab");
			}
		}
		function je(e, t) {
			e.clipboardData?.setData("text/plain", E(t)), e.clipboardData?.setData("text/html", v(t)), e.clipboardData?.setData(k, w(t));
		}
		function Me(e) {
			ue();
			let t = M.slice();
			t.length && (e.preventDefault(), je(e, t));
		}
		function Ne(e) {
			ue();
			let t = M.slice();
			e.preventDefault(), t.length && !M.readOnly && M.cut() && je(e, t);
		}
		function Pe(e, t) {
			if (!e) return [];
			if (!t) {
				let t = D(e.getData(k));
				if (t) return t;
				let n = r.paste === "plain" ? "" : e.getData("text/html");
				if (n) {
					let e = new DOMParser().parseFromString(n, "text/html"), t = ee(e.body);
					if (t.length) return t;
				}
			}
			let n = e.getData("text/plain");
			return n ? x(n) : [];
		}
		function Fe(e) {
			if (e.preventDefault(), M.readOnly) return;
			ue();
			let t = Pe(e.clipboardData, ke);
			ke = !1, t.length && M.paste(t, "paste");
		}
		function Ie(e) {
			if (e.preventDefault(), M.readOnly) return;
			let t = document.caretRangeFromPoint?.(e.clientX, e.clientY), n = t ? a.value?.caretFromDom(t.startContainer, t.startOffset) : void 0;
			if (!n) return;
			M.setSelection({
				anchor: n,
				focus: n
			});
			let r = Pe(e.dataTransfer, !0);
			r.length && M.paste(r, "drop");
		}
		function Le(e) {
			e.preventDefault();
		}
		function Re() {
			let e = window.getSelection(), t = le();
			e?.isCollapsed && e.anchorNode && t?.contains(e.anchorNode) && (a.value?.pointFromDom(e.anchorNode, e.anchorOffset) || (ue(), M.selection && q()));
		}
		function ze() {
			l.value = !0;
		}
		function Be() {
			l.value = !1;
		}
		let Ve = [
			["beforeinput", X],
			["input", xe],
			["compositionstart", Ee],
			["compositionend", De],
			["keydown", Ae],
			["copy", Me],
			["cut", Ne],
			["paste", Fe],
			["drop", Ie],
			["dragstart", Le],
			["mouseup", Re],
			["pointerdown", ve],
			["focus", ze],
			["blur", Be]
		];
		function He() {
			let e = le();
			e && (e.contentEditable = M.readOnly ? "false" : "true", e.tabIndex = 0, e.spellcheck = !!r.spellcheck, e.setAttribute("role", "textbox"), e.setAttribute("aria-multiline", "true"), e.setAttribute("aria-readonly", String(M.readOnly)), e.setAttribute("aria-label", r.ariaLabel ?? "文档正文"), e.setAttribute("autocorrect", "off"), e.setAttribute("autocapitalize", "off"), e.setAttribute("translate", "no"), e.dataset.testid = "docs-editor-surface");
		}
		se(() => {
			let e = le();
			He();
			for (let [t, n] of Ve) e?.addEventListener(t, n);
			document.addEventListener("selectionchange", fe);
		}), ce(() => {
			let e = le();
			for (let [t, n] of Ve) e?.removeEventListener(t, n);
			document.removeEventListener("selectionchange", fe);
		});
		function Ue(e, t) {
			if (u.value) return !1;
			We();
			let n = M.exec(e, t);
			return M.selection && le()?.focus({ preventScroll: !0 }), n ? (V = !0, H = !0, ae(Y)) : M.selection && q(), n;
		}
		function We() {
			let e = window.getSelection();
			e?.anchorNode && le()?.contains(e.anchorNode) && ue();
		}
		function Ge(e) {
			return m.value, M.can(e);
		}
		function Ke() {
			let e = le();
			if (e) {
				if (e.focus({ preventScroll: !0 }), !M.selection) {
					let e = S(M.doc).texts[0];
					e && M.setSelection({
						anchor: {
							node: e.id,
							offset: 0
						},
						focus: {
							node: e.id,
							offset: 0
						}
					});
				}
				q();
			}
		}
		function qe(e) {
			M.setSelection(e), V = !0, H = !0, ae(Y);
		}
		return t({
			exec: Ue,
			can: Ge,
			focus: Ke,
			undo: () => Ue("undo"),
			redo: () => Ue("redo"),
			markSaved: () => M.markSaved(),
			clearHistory: () => {
				M.clearHistory(), m.value++;
			},
			getModel: () => M.doc,
			getSelection: () => F(M.selection),
			setSelection: qe,
			insertText: (e) => {
				let t = M.insertText(e, "api");
				return t && ae(Y), t;
			},
			scrollToAnchor: (e) => a.value?.scrollToAnchor(e) ?? Promise.resolve("missing"),
			scrollToPage: (e) => a.value?.scrollToPage(e - 1),
			whenIdle: () => a.value?.whenIdle() ?? Promise.resolve(),
			relayout: async () => {
				await a.value?.repaginate(), await a.value?.whenIdle();
			},
			pageOf: (e) => a.value?.pageOf(e),
			engine: () => a.value?.engine() ?? "paged",
			metrics: () => ({
				inputMs: [...g.inputMs],
				settleMs: [...g.settleMs]
			}),
			state: te,
			controller: M
		}), (t, n) => (U(), L("section", {
			class: oe(["mo-docs-editor", {
				"mo-docs-editor--focused": l.value,
				"mo-docs-editor--readonly": e.readOnly
			}]),
			"data-testid": "docs-editor"
		}, [R("div", {
			ref_key: "viewport",
			ref: o,
			class: "mo-docs-editor__viewport",
			"data-document-scroll": ""
		}, [re(At, {
			ref_key: "preview",
			ref: a,
			model: s.value,
			context: e.context,
			"embedded-fonts": e.embeddedFonts,
			"font-revision": e.fontRevision,
			zoom: e.zoom ?? "fit-width",
			engine: e.engine,
			compact: "",
			bare: "",
			editable: "",
			onPagesChanging: ge,
			onPagesChanged: _e,
			onPagination: ye
		}, null, 8, [
			"model",
			"context",
			"embedded-fonts",
			"font-revision",
			"zoom",
			"engine"
		])], 512), R("div", jt, K(c.value), 1)], 2));
	}
}), Pt = {
	class: "mo-editor-page",
	"data-testid": "docs-editor-page"
}, Ft = { class: "mo-editor-page__bar" }, It = { class: "mo-editor-page__title" }, Lt = {
	key: 0,
	class: "mo-editor-page__dirty",
	title: "有未保存的修改"
}, Rt = { class: "mo-editor-page__actions" }, zt = {
	class: "mo-editor-page__ribbon",
	role: "toolbar",
	"aria-label": "编辑工具栏"
}, Bt = {
	class: "mo-editor-page__group",
	role: "group",
	"aria-label": "撤销与重做"
}, Vt = ["disabled"], Ht = ["disabled"], Ut = {
	class: "mo-editor-page__group",
	role: "group",
	"aria-label": "段落样式"
}, Wt = ["disabled", "value"], Gt = ["value"], Kt = ["disabled", "value"], qt = ["value"], Jt = {
	class: "mo-editor-page__group",
	role: "group",
	"aria-label": "字符格式"
}, Yt = [
	"data-command",
	"disabled",
	"aria-pressed",
	"aria-label",
	"title",
	"onClick"
], Xt = ["disabled"], Zt = {
	class: "mo-editor-page__group",
	role: "group",
	"aria-label": "段落格式"
}, Qt = [
	"data-command",
	"disabled",
	"aria-pressed",
	"aria-label",
	"title",
	"onClick"
], $t = ["data-align"], en = ["disabled"], tn = ["disabled"], nn = ["disabled"], rn = {
	key: 0,
	class: "mo-editor-page__group",
	role: "group",
	"aria-label": "表格",
	"data-testid": "table-tools"
}, an = ["disabled"], on = ["disabled"], sn = ["disabled"], cn = {
	class: "mo-editor-page__group mo-editor-page__group--end",
	role: "group",
	"aria-label": "视图"
}, ln = ["aria-pressed"], un = { class: "mo-editor-page__body" }, dn = {
	key: 0,
	class: "mo-editor-page__outline",
	"aria-label": "文档导航"
}, fn = {
	key: 0,
	class: "mo-editor-page__empty"
}, pn = ["title", "onClick"], Q = {
	key: 1,
	class: "mo-editor-page__aside"
}, mn = { class: "mo-editor-page__status" }, hn = { "data-testid": "editor-page-indicator" }, gn = {
	key: 0,
	role: "status"
}, _n = { key: 1 }, vn = ["title"], yn = {
	class: "mo-editor-page__notice",
	role: "status",
	"aria-live": "polite"
}, bn = /* @__PURE__ */ ie({
	__name: "DocsEditorPage",
	props: {
		model: {},
		context: {},
		title: {},
		readOnly: { type: Boolean },
		protectedRanges: {},
		overlays: {},
		actor: {},
		constraints: {},
		beforeTransaction: {},
		styles: {},
		outline: {
			type: Boolean,
			default: !0
		},
		engine: {},
		embeddedFonts: {},
		fontRevision: {}
	},
	emits: [
		"transaction",
		"update:model",
		"selection-change",
		"blocked",
		"pagination",
		"state-change"
	],
	setup(e, { expose: t, emit: n }) {
		let r = e, i = n, a = W(), o = W(), s = W("fit-width"), c = W(""), l = W([]), u = W(!0), d, p = P(() => o.value?.format ?? null), m = P(() => !!r.readOnly || !p.value);
		function h(e, t) {
			a.value?.exec(e, t);
		}
		function g(e) {
			return o.value, !r.readOnly && (a.value?.can(e) ?? !1);
		}
		function _(e) {
			o.value = e, i("state-change", e);
		}
		function v(e) {
			c.value = e.kind === "readonly" ? "文档为只读" : e.kind === "constraint" ? "当前主题不允许此格式修改" : e.kind === "host" ? "此修改未被允许" : "此处内容受保护，不能修改", clearTimeout(d), d = setTimeout(() => c.value = "", 2600), i("blocked", e);
		}
		function y(e) {
			l.value = e.warnings, i("pagination", e);
		}
		let b = [
			{
				name: "bold",
				label: "加粗",
				glyph: "B",
				hint: "Ctrl+B"
			},
			{
				name: "italic",
				label: "斜体",
				glyph: "I",
				hint: "Ctrl+I"
			},
			{
				name: "underline",
				label: "下划线",
				glyph: "U",
				hint: "Ctrl+U"
			},
			{
				name: "strike",
				label: "删除线",
				glyph: "S",
				hint: ""
			},
			{
				name: "superscript",
				label: "上标",
				glyph: "x²",
				hint: ""
			},
			{
				name: "subscript",
				label: "下标",
				glyph: "x₂",
				hint: ""
			}
		], x = [
			{
				value: "start",
				label: "左对齐"
			},
			{
				value: "center",
				label: "居中"
			},
			{
				value: "end",
				label: "右对齐"
			},
			{
				value: "justify",
				label: "两端对齐"
			}
		], S = P(() => r.styles ?? Object.keys(r.context.styles ?? {}).map((e) => ({ name: e }))), C = P(() => p.value == null || p.value.heading === "mixed" ? "" : String(p.value.heading)), w = P(() => !p.value?.style || p.value.style === "mixed" ? "" : p.value.style);
		function T(e, t) {
			for (let n of e) if (n.type === "heading") t.push({
				id: n.id,
				level: n.level,
				text: f(n.inlines).trim()
			});
			else if (n.type === "quote" || n.type === "container") T(n.blocks, t);
			else if (n.type === "list") for (let e of n.items) T(e.blocks, t);
		}
		let ee = P(() => {
			let e = [];
			for (let t of r.model.sections) T(t.blocks, e);
			return e;
		});
		function E(e) {
			let t = { node: e.id };
			a.value?.scrollToAnchor(t), a.value?.setSelection({
				anchor: {
					node: e.id,
					offset: 0
				},
				focus: {
					node: e.id,
					offset: 0
				}
			});
		}
		let D = P(() => {
			let e = 0, t = (n) => {
				for (let r of n) if (r.type === "paragraph" || r.type === "heading") e += f(r.inlines).replace(/[\s￼]/g, "").length;
				else if (r.type === "quote" || r.type === "container") t(r.blocks);
				else if (r.type === "list") for (let e of r.items) t(e.blocks);
				else if (r.type === "table") for (let e of r.rows) for (let n of e.cells) t(n.blocks);
			};
			for (let e of r.model.sections) t(e.blocks);
			return e;
		});
		return t({ editor: a }), (t, n) => (U(), L("section", Pt, [
			R("header", Ft, [R("div", It, [ue(t.$slots, "title", {}, () => [R("strong", null, K(e.title ?? e.model.meta?.title ?? "未命名文档"), 1)]), o.value?.dirty ? (U(), L("span", Lt, "●")) : I("v-if", !0)]), R("div", Rt, [ue(t.$slots, "actions")])]),
			R("div", zt, [
				R("div", Bt, [R("button", {
					type: "button",
					class: "mo-tool",
					"data-command": "undo",
					disabled: !o.value?.canUndo,
					"aria-label": "撤销",
					title: "撤销 (Ctrl+Z)",
					onMousedown: n[0] ||= q(() => {}, ["prevent"]),
					onClick: n[1] ||= (e) => h("undo")
				}, "↶", 40, Vt), R("button", {
					type: "button",
					class: "mo-tool",
					"data-command": "redo",
					disabled: !o.value?.canRedo,
					"aria-label": "重做",
					title: "重做 (Ctrl+Y)",
					onMousedown: n[2] ||= q(() => {}, ["prevent"]),
					onClick: n[3] ||= (e) => h("redo")
				}, "↷", 40, Ht)]),
				R("div", Ut, [R("select", {
					class: "mo-tool-select",
					"aria-label": "标题级别",
					"data-command": "heading",
					disabled: m.value,
					value: C.value,
					onChange: n[4] ||= (e) => h("heading", Number(e.target.value))
				}, [
					n[26] ||= R("option", {
						value: "",
						disabled: ""
					}, "（多种）", -1),
					n[27] ||= R("option", { value: "0" }, "正文", -1),
					(U(), L(N, null, G(6, (e) => R("option", {
						key: e,
						value: e
					}, "标题 " + K(e), 9, Gt)), 64))
				], 40, Wt), S.value.length ? (U(), L("select", {
					key: 0,
					class: "mo-tool-select",
					"aria-label": "命名样式",
					"data-command": "style",
					disabled: m.value,
					value: w.value,
					onChange: n[5] ||= (e) => h("style", e.target.value)
				}, [n[28] ||= R("option", {
					value: "",
					disabled: ""
				}, "样式", -1), (U(!0), L(N, null, G(S.value, (e) => (U(), L("option", {
					key: e.name,
					value: e.name
				}, K(e.label ?? e.name), 9, qt))), 128))], 40, Kt)) : I("v-if", !0)]),
				R("div", Jt, [(U(), L(N, null, G(b, (e) => R("button", {
					key: e.name,
					type: "button",
					class: oe(["mo-tool", `mo-tool--${e.name}`]),
					"data-command": e.name,
					disabled: m.value,
					"aria-pressed": p.value?.[e.name] === !0 ? "true" : p.value?.[e.name] === "mixed" ? "mixed" : "false",
					"aria-label": e.label,
					title: e.hint ? `${e.label} (${e.hint})` : e.label,
					onMousedown: n[6] ||= q(() => {}, ["prevent"]),
					onClick: (t) => h(e.name)
				}, K(e.glyph), 43, Yt)), 64)), R("button", {
					type: "button",
					class: "mo-tool",
					"data-command": "clearFormatting",
					disabled: m.value,
					"aria-label": "清除格式",
					title: "清除格式",
					onMousedown: n[7] ||= q(() => {}, ["prevent"]),
					onClick: n[8] ||= (e) => h("clearFormatting")
				}, [...n[29] ||= [ne("⌫", -1), R("span", { "aria-hidden": "true" }, "A", -1)]], 40, Xt)]),
				R("div", Zt, [
					(U(), L(N, null, G(x, (e) => R("button", {
						key: e.value,
						type: "button",
						class: "mo-tool mo-tool--align",
						"data-command": `align-${e.value}`,
						disabled: m.value,
						"aria-pressed": (p.value?.align ?? "start") === e.value,
						"aria-label": e.label,
						title: e.label,
						onMousedown: n[9] ||= q(() => {}, ["prevent"]),
						onClick: (t) => h("align", e.value)
					}, [R("span", {
						class: "mo-align",
						"data-align": e.value,
						"aria-hidden": "true"
					}, [...n[30] ||= [
						R("i", null, null, -1),
						R("i", null, null, -1),
						R("i", null, null, -1)
					]], 8, $t)], 40, Qt)), 64)),
					R("button", {
						type: "button",
						class: "mo-tool",
						"data-command": "outdent",
						disabled: m.value,
						"aria-label": "减少缩进",
						title: "减少缩进",
						onMousedown: n[10] ||= q(() => {}, ["prevent"]),
						onClick: n[11] ||= (e) => h("outdent")
					}, "⇤", 40, en),
					R("button", {
						type: "button",
						class: "mo-tool",
						"data-command": "indent",
						disabled: m.value,
						"aria-label": "增加缩进",
						title: "增加缩进",
						onMousedown: n[12] ||= q(() => {}, ["prevent"]),
						onClick: n[13] ||= (e) => h("indent")
					}, "⇥", 40, tn),
					R("select", {
						class: "mo-tool-select",
						"aria-label": "行距",
						"data-command": "lineSpacing",
						disabled: m.value,
						value: "",
						onChange: n[14] ||= (e) => {
							h("lineSpacing", Number(e.target.value)), e.target.value = "";
						}
					}, [...n[31] ||= [z("<option value=\"\" disabled>行距</option><option value=\"1\">单倍</option><option value=\"1.25\">1.25 倍</option><option value=\"1.5\">1.5 倍</option><option value=\"2\">2 倍</option>", 5)]], 40, nn)
				]),
				p.value?.inTable ? (U(), L("div", rn, [
					R("button", {
						type: "button",
						class: "mo-tool mo-tool--text",
						"data-command": "table.insertRowAbove",
						disabled: !g("table.insertRowAbove"),
						onMousedown: n[15] ||= q(() => {}, ["prevent"]),
						onClick: n[16] ||= (e) => h("table.insertRowAbove")
					}, "上方插行", 40, an),
					R("button", {
						type: "button",
						class: "mo-tool mo-tool--text",
						"data-command": "table.insertRowBelow",
						disabled: !g("table.insertRowBelow"),
						onMousedown: n[17] ||= q(() => {}, ["prevent"]),
						onClick: n[18] ||= (e) => h("table.insertRowBelow")
					}, "下方插行", 40, on),
					R("button", {
						type: "button",
						class: "mo-tool mo-tool--text",
						"data-command": "table.deleteRow",
						disabled: !g("table.deleteRow"),
						onMousedown: n[19] ||= q(() => {}, ["prevent"]),
						onClick: n[20] ||= (e) => h("table.deleteRow")
					}, "删除行", 40, sn),
					n[32] ||= R("button", {
						type: "button",
						class: "mo-tool mo-tool--text",
						"data-command": "table.mergeCells",
						disabled: "",
						title: "内核暂未提供合并单元格与列操作"
					}, "合并单元格", -1)
				])) : I("v-if", !0),
				R("div", cn, [
					e.outline ? (U(), L("button", {
						key: 0,
						type: "button",
						class: "mo-tool mo-tool--text",
						"aria-pressed": u.value,
						onClick: n[21] ||= (e) => u.value = !u.value
					}, "导航", 8, ln)) : I("v-if", !0),
					me(R("select", {
						"onUpdate:modelValue": n[22] ||= (e) => s.value = e,
						class: "mo-tool-select",
						"aria-label": "缩放"
					}, [...n[33] ||= [
						R("option", { value: "fit-width" }, "适应页宽", -1),
						R("option", { value: .75 }, "75%", -1),
						R("option", { value: 1 }, "100%", -1),
						R("option", { value: 1.25 }, "125%", -1),
						R("option", { value: 1.5 }, "150%", -1)
					]], 512), [[fe, s.value]]),
					ue(t.$slots, "tools")
				])
			]),
			R("div", un, [
				e.outline && u.value ? (U(), L("nav", dn, [ee.value.length ? I("v-if", !0) : (U(), L("p", fn, "文档里还没有标题")), (U(!0), L(N, null, G(ee.value, (e) => (U(), L("button", {
					key: e.id,
					type: "button",
					class: "mo-outline-item",
					style: H({ paddingInlineStart: `${8 + (e.level - 1) * 12}px` }),
					title: e.text,
					onClick: (t) => E(e)
				}, K(e.text || "（空标题）"), 13, pn))), 128))])) : I("v-if", !0),
				re(Nt, {
					ref_key: "editor",
					ref: a,
					class: "mo-editor-page__editor",
					model: e.model,
					context: e.context,
					"read-only": e.readOnly,
					zoom: s.value,
					"protected-ranges": e.protectedRanges,
					overlays: e.overlays,
					actor: e.actor,
					constraints: e.constraints,
					"before-transaction": e.beforeTransaction,
					engine: e.engine,
					"embedded-fonts": e.embeddedFonts,
					"font-revision": e.fontRevision,
					onTransaction: n[23] ||= (e, t) => i("transaction", e, t),
					"onUpdate:model": n[24] ||= (e) => i("update:model", e),
					onSelectionChange: n[25] ||= (e) => i("selection-change", e),
					onBlocked: v,
					onPagination: y,
					onStateChange: _
				}, null, 8, [
					"model",
					"context",
					"read-only",
					"zoom",
					"protected-ranges",
					"overlays",
					"actor",
					"constraints",
					"before-transaction",
					"engine",
					"embedded-fonts",
					"font-revision"
				]),
				t.$slots.aside ? (U(), L("aside", Q, [ue(t.$slots, "aside")])) : I("v-if", !0)
			]),
			R("footer", mn, [
				R("span", hn, "第 " + K(o.value?.currentPage || "–") + " 页，共 " + K(o.value?.pages ?? 0) + " 页", 1),
				R("span", null, K(D.value) + " 字", 1),
				o.value && !o.value.layoutComplete ? (U(), L("span", gn, "正在排版后续页面…")) : I("v-if", !0),
				e.readOnly ? (U(), L("span", _n, "只读")) : I("v-if", !0),
				l.value.length ? (U(), L("span", {
					key: 2,
					title: l.value.join("\n")
				}, "版式提示 " + K(l.value.length) + " 条", 9, vn)) : I("v-if", !0),
				R("span", yn, K(c.value), 1),
				ue(t.$slots, "status")
			])
		]));
	}
});
export { j as DocOpsError, Nt as DocsEditor, O as DocsEditorController, bn as DocsEditorPage, k as SLICE_MIME, _ as applyOp, g as applyOps, b as createId, A as mapAnchor, M as mapPoint, y as mapRange };
