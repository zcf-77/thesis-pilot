import { inlineLength as e, paragraphText as t } from "../docs-anchors.js";
// packages/vue/src/docs-editor/ops.ts
var n = (e) => e?.type === "paragraph" || e?.type === "heading", r = class extends Error {
	code;
	index;
	op;
	constructor(e, t, n, r) {
		super(e === "theme_constraint" ? `op #${t} ${n}: rejected by controlled theme: ${r}` : `op #${t} ${n}: ${r}`), this.name = "DocOpsError", this.code = e, this.index = t, this.op = n;
	}
};
function i(e, t, n) {
	for (let r = 0; r < e.length; r++) {
		let a = e[r], o = [...n, {
			key: "blocks",
			index: r
		}];
		if (a.id === t) return o;
		let s;
		if (a.type === "quote" || a.type === "container") s = i(a.blocks, t, o);
		else if (a.type === "list") for (let e = 0; e < a.items.length && !s; e++) s = i(a.items[e].blocks, t, [...o, {
			key: "items",
			index: e
		}]);
		else if (a.type === "table") for (let e = 0; e < a.rows.length && !s; e++) for (let n = 0; n < a.rows[e].cells.length && !s; n++) s = i(a.rows[e].cells[n].blocks, t, [
			...o,
			{
				key: "rows",
				index: e
			},
			{
				key: "cells",
				index: n
			}
		]);
		if (s) return s;
	}
}
function a(e, t, n) {
	for (let r = 0; r < e.sections.length; r++) {
		if (n != null && r !== n) continue;
		let a = i(e.sections[r].blocks, t, []);
		if (a) return {
			section: r,
			steps: a
		};
	}
}
function o(e, t) {
	let n = e.sections[t.section];
	for (let e = 0; e < t.steps.length - 1; e++) n = n[t.steps[e].key][t.steps[e].index];
	let r = t.steps[t.steps.length - 1];
	return {
		list: n[r.key],
		index: r.index
	};
}
function s(e, t) {
	let { list: n, index: r } = o(e, t);
	return n[r];
}
function c(e) {
	for (let t = e.steps.length - 2; t >= 0; t--) if (e.steps[t].key === "blocks") return {
		section: e.section,
		steps: e.steps.slice(0, t + 1)
	};
}
function l(e, t, n, r) {
	let { key: i, index: a } = t[n], o = e[i];
	if (n === t.length - 1) return {
		...e,
		[i]: r(o, a)
	};
	let s = o.slice();
	return s[a] = l(o[a], t, n + 1, r), {
		...e,
		[i]: s
	};
}
function u(e, t, n) {
	let r = e.sections.slice();
	return r[t.section] = l(e.sections[t.section], t.steps, 0, n), {
		...e,
		sections: r
	};
}
function d(e, t, n) {
	return u(e, t, (e, t) => {
		let r = e.slice();
		return r[t] = n, r;
	});
}
var f = (e) => e == null;
function p(e) {
	if (!e) return;
	let t = Object.entries(e).filter(([, e]) => !f(e));
	return t.length ? Object.fromEntries(t) : void 0;
}
function m(e, t) {
	if (e === t || f(e) && f(t)) return !0;
	if (typeof e != "object" || typeof t != "object" || !e || !t) return f(e) && h(t) || f(t) && h(e);
	if (Array.isArray(e) !== Array.isArray(t)) return !1;
	if (Array.isArray(e) && Array.isArray(t)) return e.length === t.length && e.every((e, n) => m(e, t[n]));
	let n = e, r = t;
	for (let e of /* @__PURE__ */ new Set([...Object.keys(n), ...Object.keys(r)])) if (!m(n[e], r[e])) return !1;
	return !0;
}
function h(e) {
	return typeof e == "object" && !!e && !Array.isArray(e) && Object.values(e).every(f);
}
function g(e) {
	let t = [];
	for (let n of e) if (n.type === "run") for (let e of n.text) t.push({
		ch: e,
		props: n.props
	});
	else t.push({ other: n });
	return t;
}
function _(e) {
	let t = [], n, r = () => {
		if (!n) return;
		let e = p(n.props);
		t.push(e ? {
			type: "run",
			text: n.text,
			props: e
		} : {
			type: "run",
			text: n.text
		}), n = void 0;
	};
	for (let i of e) "other" in i ? (r(), t.push(i.other)) : n && (n.props === i.props || m(n.props, i.props)) ? n.text += i.ch : (r(), n = {
		text: i.ch,
		props: i.props
	});
	return r(), t;
}
function v(e, t) {
	return p({
		...e,
		...p(t)
	});
}
var y = [
	"before",
	"after",
	"line"
], ee = [
	"start",
	"end",
	"firstLine",
	"hanging",
	"startChars",
	"endChars",
	"firstLineChars"
], te = [
	"style",
	"align",
	"keepWithNext",
	"keepLines",
	"widowControl",
	"autoSpaceDe",
	"autoSpaceDn",
	"pageBreakBefore",
	"outlineLevel",
	"shading",
	"borders",
	"snapToGrid",
	"kinsoku",
	"overflowPunct",
	"topLinePunct",
	"adjustRightInd",
	"listLabel"
];
function ne(e, t) {
	let n = { ...e }, r = t ?? {};
	for (let e of te) f(r[e]) || (n[e] = r[e]);
	let i = (e, t) => {
		let i = { ...n[e] }, a = r[e] ?? {};
		for (let e of t) f(a[e]) || (i[e] = a[e]);
		let o = p(i);
		o ? n[e] = o : delete n[e];
	};
	i("spacing", y), i("indent", ee), Array.isArray(r.tabs) && r.tabs.length && (n.tabs = r.tabs);
	let a = v(n.run, r.run);
	return a ? n.run = a : delete n.run, Array.isArray(n.tabs) && !n.tabs.length && delete n.tabs, p(n);
}
function re(e, t) {
	let { props: n, ...r } = e;
	return t ? {
		...r,
		props: t
	} : r;
}
function b(e, t) {
	let n = !1, r = e.map((e) => {
		let r = t(e);
		return r !== e && (n = !0), r;
	});
	return n ? r : e;
}
function x(e, t = {}) {
	let n = e, r;
	for (let e of Object.keys(n)) {
		let i = n[e];
		(f(i) || e in t && (t[e] === S ? h(i) || Array.isArray(i) && !i.length : i === t[e])) && (r ??= { ...n }, delete r[e]);
	}
	return r ?? n;
}
var S = Symbol("empty");
function ie(e) {
	if (!e) return;
	let t = x(e);
	return Object.keys(t).length ? t : void 0;
}
function ae(e) {
	if (!e) return;
	let t = x(e, { tabs: S }), n = (e, n) => {
		if (t[e] == null) return;
		let r = n(t[e]);
		r == null || h(r) ? (t = { ...t }, delete t[e]) : r !== t[e] && (t = {
			...t,
			[e]: r
		});
	};
	return n("spacing", (e) => x(e)), n("indent", (e) => x(e)), n("run", (e) => ie(e)), Object.keys(t).length ? t : void 0;
}
function C(e, t, n) {
	if (e[t] === n && (n !== void 0 || !(t in e))) return e;
	let r = { ...e };
	return n === void 0 ? delete r[t] : r[t] = n, r;
}
function oe(e) {
	return b(e, (e) => e.type === "run" ? C(e, "props", ie(e.props)) : e.type === "break" ? e.kind ? e : {
		...e,
		kind: "line"
	} : e);
}
function w(e) {
	switch (e.type) {
		case "paragraph":
		case "heading": return C(C(e, "props", ae(e.props)), "inlines", oe(e.inlines));
		case "quote":
		case "container": {
			let t = C(e, "blocks", b(e.blocks, w));
			return t.type === "container" ? x(t, { attrs: S }) : t;
		}
		case "list": return C(e, "items", b(e.items, (e) => C(e, "blocks", b(e.blocks, w))));
		case "table": {
			let t = b(e.rows, (e) => {
				let t = b(e.cells, (e) => C(x(e, {
					colSpan: 1,
					rowSpan: 1,
					props: S
				}), "blocks", b(e.blocks, w)));
				return C(x(e, { header: !1 }), "cells", t);
			});
			return C(x(e, {
				props: S,
				colWidths: S
			}), "rows", t);
		}
		case "toc": return e.levels == null ? {
			...e,
			levels: 3
		} : e;
		default: return e;
	}
}
function se(e, t, n) {
	if (t === n) return [];
	let r = Array.from(t), i = Array.from(n), a = 0;
	for (; a < r.length && a < i.length && r[a] === i[a];) a++;
	let o = 0;
	for (; o < r.length - a && o < i.length - a && r[r.length - 1 - o] === i[i.length - 1 - o];) o++;
	return [{
		kind: "text",
		node: e,
		start: a,
		end: r.length - o,
		insert: i.length - a - o
	}];
}
function T(e, r) {
	if (n(e)) r.set(e.id, t(e.inlines));
	else if (e.type === "quote" || e.type === "container") for (let t of e.blocks) T(t, r);
	else if (e.type === "list") for (let t of e.items) for (let e of t.blocks) T(e, r);
	else if (e.type === "table") for (let t of e.rows) for (let e of t.cells) for (let t of e.blocks) T(t, r);
}
function E(e, t) {
	let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map();
	T(e, n), t && T(t, r);
	let i = [];
	for (let [e, t] of n) {
		let n = r.get(e);
		n == null ? i.push({
			kind: "remove",
			node: e
		}) : i.push(...se(e, t, n));
	}
	return i;
}
function D(e, t, n) {
	let i = () => {
		throw new r("unsupported", t, n, "client mirror requires explicit node ids (empty id is assigned by the kernel only)");
	};
	if (e.id || i(), e.type === "quote" || e.type === "container") for (let r of e.blocks) D(r, t, n);
	else if (e.type === "list") for (let r of e.items) {
		r.id || i();
		for (let e of r.blocks) D(e, t, n);
	}
	else if (e.type === "table") for (let r of e.rows) {
		r.id || i();
		for (let e of r.cells) {
			e.id || i();
			for (let r of e.blocks) D(r, t, n);
		}
	}
}
function O(e, t, n, i, a) {
	if (e.constraints !== "controlled") return;
	let o = [];
	if ((i?.font != null || i?.fontEastAsia != null) && o.push("font"), i?.size != null && o.push("size"), a && (a.spacing?.line != null && o.push("line spacing"), (a.run?.font != null || a.run?.size != null) && o.push("paragraph run font/size")), o.length) throw new r("theme_constraint", t, n, o.join(", "));
}
var k = (e, t, n) => new r("node_not_found", e, t, `node not found: ${n}`), A = (e, t, n) => new r("invalid", e, t, n);
function ce(e, t, r) {
	if (!n(e)) throw A(t, r, "block has no inline text (not a paragraph/heading)");
	return e;
}
function le(e, t, n, r) {
	if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < 0 || e.start > e.end || e.end > t) throw A(n, r, `range ${e.start}..${e.end} out of 0..${t}`);
}
function ue(e, t, n, r) {
	if (t == null) {
		if (!e.sections.length) throw A(n, r, "document has no sections");
		return 0;
	}
	let i = e.sections.findIndex((e) => e.id === t);
	if (i < 0) throw k(n, r, t);
	return i;
}
function de(e, t) {
	if (t > 0) return {
		kind: "after",
		id: e[t - 1].id
	};
	if (e.length > 1) return {
		kind: "before",
		id: e[1].id
	};
}
function j(e, i, l = 0, f = {}) {
	let m = i.op, h = (t) => {
		let n = a(e, t);
		if (!n) throw k(l, m, t);
		return n;
	}, y = (t, n) => {
		let r = h(t), i = ce(s(e, r), l, m), { block: a, steps: o } = n(i);
		return {
			doc: d(e, r, a),
			inverse: [{
				op: "doc.replace_block",
				id: a.id,
				block: i
			}],
			steps: o ?? []
		};
	};
	switch (i.op) {
		case "doc.insert_block": {
			D(i.block, l, m);
			let t = ue(e, i.section, l, m);
			n(i.block) && O(f, l, m, i.block.props?.run, i.block.props ?? {});
			let r = w(i.block), o = i.at, s, c = 0;
			if (o.kind === "before" || o.kind === "after") {
				let n = a(e, o.id, i.section == null ? void 0 : t);
				if (!n) throw k(l, m, o.id);
				s = n, c = +(o.kind === "after");
			} else {
				let n = e.sections[t].blocks.length;
				s = {
					section: t,
					steps: [{
						key: "blocks",
						index: o.kind === "start" ? 0 : o.kind === "end" ? n : Math.min(o.index, n)
					}]
				};
			}
			return {
				doc: u(e, s, (e, t) => {
					let n = e.slice();
					return n.splice(t + c, 0, r), n;
				}),
				inverse: [{
					op: "doc.delete_block",
					id: i.block.id
				}],
				steps: []
			};
		}
		case "doc.delete_block": {
			let t = h(i.id), { list: n, index: r } = o(e, t), a = n[r], l = u(e, t, (e, t) => e.filter((e, n) => n !== t)), d = de(n, r), f = c(t);
			return {
				doc: l,
				inverse: d ? [{
					op: "doc.insert_block",
					at: d,
					block: a
				}] : f ? [{
					op: "doc.replace_block",
					id: s(e, f).id,
					block: s(e, f)
				}] : [{
					op: "doc.insert_block",
					section: e.sections[t.section].id,
					at: {
						kind: "index",
						index: 0
					},
					block: a
				}],
				steps: E(a, void 0)
			};
		}
		case "doc.move_block": {
			let t;
			for (let n = 0; n < e.sections.length && !t; n++) {
				let r = e.sections[n].blocks.findIndex((e) => e.id === i.id);
				r >= 0 && (t = {
					section: n,
					steps: [{
						key: "blocks",
						index: r
					}]
				});
			}
			if (!t) throw k(l, m, i.id);
			let n = e.sections[t.section].blocks, r = t.steps[0].index, a = n[r], o = n.filter((e, t) => t !== r), s = i.at, c;
			if (s.kind === "start") c = 0;
			else if (s.kind === "end") c = o.length;
			else if (s.kind === "index") c = Math.min(s.index, o.length);
			else {
				let e = o.findIndex((e) => e.id === s.id);
				if (e < 0) throw k(l, m, s.id);
				c = s.kind === "after" ? e + 1 : e;
			}
			o.splice(c, 0, a);
			let u = e.sections.slice();
			return u[t.section] = {
				...e.sections[t.section],
				blocks: o
			}, {
				doc: {
					...e,
					sections: u
				},
				inverse: [{
					op: "doc.move_block",
					id: i.id,
					at: {
						kind: "index",
						index: r
					}
				}],
				steps: []
			};
		}
		case "doc.replace_block": {
			let t = h(i.id), r = s(e, t), a = w(i.block.id ? i.block : {
				...i.block,
				id: i.id
			});
			return D(a, l, m), n(a) && O(f, l, m, a.props?.run, a.props ?? {}), {
				doc: d(e, t, a),
				inverse: [{
					op: "doc.replace_block",
					id: a.id,
					block: r
				}],
				steps: E(r, a)
			};
		}
		case "doc.replace_text": return y(i.id, (e) => {
			if (!i.range) {
				let n = e.inlines.find((e) => e.type === "run"), r = p(n?.type === "run" ? n.props : void 0), a = e.inlines.filter((e) => e.type === "bookmark");
				return a.push(r ? {
					type: "run",
					text: i.text,
					props: r
				} : {
					type: "run",
					text: i.text
				}), {
					block: {
						...e,
						inlines: a
					},
					steps: se(e.id, t(e.inlines), t(a))
				};
			}
			let n = g(e.inlines);
			le(i.range, n.length, l, m);
			let { start: r, end: a } = i.range, o = r < n.length ? n[r] : n[Math.max(0, r - 1)], s = o && "ch" in o ? o.props : void 0, c = Array.from(i.text, (e) => ({
				ch: e,
				props: s
			}));
			return n.splice(r, a - r, ...c), {
				block: {
					...e,
					inlines: _(n)
				},
				steps: [{
					kind: "text",
					node: e.id,
					start: r,
					end: a,
					insert: c.length
				}]
			};
		});
		case "doc.set_inlines": {
			for (let e of i.inlines) e.type === "run" && O(f, l, m, e.props);
			let e = oe(i.inlines);
			return y(i.id, (n) => ({
				block: {
					...n,
					inlines: e
				},
				steps: se(n.id, t(n.inlines), t(e))
			}));
		}
		case "doc.apply_style":
		case "doc.set_para_props": {
			i.op === "doc.set_para_props" && O(f, l, m, i.props.run, i.props);
			let t = e, r = [];
			for (let e of i.ids) {
				let o = a(t, e);
				if (!o) throw k(l, m, e);
				let c = s(t, o);
				if (!n(c)) throw A(l, m, "block has no paragraph properties");
				let u = i.op === "doc.apply_style" ? {
					...c.props,
					style: i.style
				} : ne(c.props, i.props);
				t = d(t, o, re(c, u)), r.unshift({
					op: "doc.replace_block",
					id: e,
					block: c
				});
			}
			return {
				doc: t,
				inverse: r,
				steps: []
			};
		}
		case "doc.set_heading_level": {
			if (!Number.isInteger(i.level) || i.level < 1 || i.level > 6) throw A(l, m, `level ${i.level} out of 1..=6`);
			let t = h(i.id), r = s(e, t);
			if (!n(r)) throw A(l, m, "not a paragraph or heading");
			let { type: a, ...o } = r;
			return {
				doc: d(e, t, {
					...o,
					type: "heading",
					level: i.level
				}),
				inverse: [{
					op: "doc.replace_block",
					id: i.id,
					block: r
				}],
				steps: []
			};
		}
		case "doc.set_run_props": return O(f, l, m, i.props), y(i.id, (e) => {
			let t = g(e.inlines);
			i.range && le(i.range, t.length, l, m);
			let n = i.range?.start ?? 0, r = i.range?.end ?? t.length, a = /* @__PURE__ */ new Map();
			for (let e = n; e < r; e++) {
				let n = t[e];
				"ch" in n && (a.has(n.props) || a.set(n.props, v(n.props, i.props)), t[e] = {
					ch: n.ch,
					props: a.get(n.props)
				});
			}
			return { block: {
				...e,
				inlines: _(t)
			} };
		});
		case "doc.table.set_cell":
		case "doc.table.delete_row": {
			let t = h(i.table), n = s(e, t);
			if (n.type !== "table") throw A(l, m, "not a table");
			let r;
			if (i.op === "doc.table.delete_row") {
				if (!Number.isInteger(i.row) || i.row < 0 || i.row >= n.rows.length) throw A(l, m, `row ${i.row} out of range`);
				r = {
					...n,
					rows: n.rows.filter((e, t) => t !== i.row)
				};
			} else {
				let e = n.rows[i.row];
				if (!e) throw A(l, m, `row ${i.row} out of range`);
				let t = e.cells[i.col];
				if (!t) throw A(l, m, `col ${i.col} out of range`);
				for (let e of i.blocks) D(e, l, m);
				let a = e.cells.slice();
				a[i.col] = {
					...t,
					blocks: i.blocks.map(w)
				};
				let o = n.rows.slice();
				o[i.row] = {
					...e,
					cells: a
				}, r = {
					...n,
					rows: o
				};
			}
			return {
				doc: d(e, t, r),
				inverse: [{
					op: "doc.replace_block",
					id: n.id,
					block: n
				}],
				steps: E(n, r)
			};
		}
		default: throw new r("unsupported", l, i.op, "operation is not mirrored on the client; send it to the kernel and reload the model");
	}
}
function fe(e, t, n = {}) {
	let r = e, i = [], a = [];
	return t.forEach((e, t) => {
		let o = j(r, e, t, n);
		r = o.doc, i.unshift(...o.inverse), a.push(...o.steps);
	}), {
		doc: r,
		inverse: i,
		steps: a
	};
}
// packages/vue/src/docs-editor/mapping.ts
function pe(e, t, n = 1) {
	let { node: r, offset: i } = e;
	for (let e of t) if (e.kind === "text") {
		if (e.node !== r) continue;
		let t = e.end - e.start;
		if (i < e.start) continue;
		i > e.end ? i += e.insert - t : i = t === 0 ? n > 0 ? e.start + e.insert : e.start : i === e.start && n < 0 ? e.start : i === e.end && n > 0 || n > 0 ? e.start + e.insert : e.start;
	} else if (e.kind === "move") {
		if (e.from !== r || i < e.start || i > e.end || !e.whole && (i === e.start && n < 0 || i === e.end && n > 0 && e.end !== e.start)) continue;
		r = e.to, i = e.at + (i - e.start);
	} else if (e.node === r) {
		if (!e.fallback) return;
		r = e.fallback.node, i = e.fallback.offset;
	}
	return {
		node: r,
		offset: i
	};
}
function me(e, t) {
	let n = [{ ...e }], r = !0;
	for (let e of t) {
		let t = [];
		for (let i of n) if (e.kind === "text") {
			if (e.node !== i.node) {
				t.push(i);
				continue;
			}
			let n = e.insert - (e.end - e.start);
			if (i.start === i.end) {
				let r = i.start <= e.start ? i.start : i.start >= e.end ? i.start + n : e.start;
				t.push({
					node: i.node,
					start: r,
					end: r
				});
			} else if (e.end <= i.start) t.push({
				node: i.node,
				start: i.start + n,
				end: i.end + n
			});
			else if (e.start >= i.end) t.push(i);
			else {
				r = !1;
				let a = i.start < e.start ? i.start : e.start + e.insert, o = i.end > e.end ? i.end + n : e.start;
				o > a && t.push({
					node: i.node,
					start: a,
					end: o
				});
			}
		} else if (e.kind === "move") {
			if (e.from !== i.node || i.end < e.start || i.start > e.end) {
				t.push(i);
				continue;
			}
			let n = e.at - e.start;
			if (i.start >= e.start && i.end <= e.end) !e.whole && i.start === i.end && (i.start === e.start || i.start === e.end) ? t.push(i) : t.push({
				node: e.to,
				start: i.start + n,
				end: i.end + n
			});
			else {
				r = !1, i.start < e.start && t.push({
					node: i.node,
					start: i.start,
					end: e.start
				});
				let a = Math.max(i.start, e.start), o = Math.min(i.end, e.end);
				o > a && t.push({
					node: e.to,
					start: a + n,
					end: o + n
				}), i.end > e.end && t.push({
					node: i.node,
					start: e.end,
					end: i.end
				});
			}
		} else e.node === i.node ? r = !1 : t.push(i);
		n = t;
	}
	return {
		segments: n.filter((e) => e.end >= e.start),
		intact: r
	};
}
function he(e) {
	let t = [];
	for (let n = e.length - 1; n >= 0; n--) {
		let r = e[n];
		r.kind === "text" ? t.push({
			kind: "text",
			node: r.node,
			start: r.start,
			end: r.start + r.insert,
			insert: r.end - r.start
		}) : r.kind === "move" && t.push({
			kind: "move",
			from: r.to,
			start: r.at,
			end: r.at + (r.end - r.start),
			to: r.from,
			at: r.start,
			whole: r.whole
		});
	}
	return t;
}
function ge(e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) n.kind === "remove" && t.add(n.node);
	return t;
}
function _e(e, t) {
	if ((e.offsetUnit ?? "scalar") !== "scalar") return;
	let n = ge(t), r = [];
	for (let i of [e, ...e.segments ?? []]) {
		if (i.start == null || i.end == null) {
			if (n.has(i.node)) continue;
			r.push({ node: i.node });
			continue;
		}
		let e = me({
			node: i.node,
			start: i.start,
			end: i.end
		}, t);
		for (let t of e.segments) (t.end > t.start || i.start === i.end) && r.push(t);
	}
	if (!r.length) return;
	let [i, ...a] = r;
	return a.length ? {
		...i,
		segments: a
	} : { ...i };
}
// packages/vue/src/docs-editor/tree.ts
var ve = /* @__PURE__ */ new WeakMap();
function M(e) {
	let t = ve.get(e);
	if (t) return t;
	let r = /* @__PURE__ */ new Map(), i = [], a = /* @__PURE__ */ new Map(), o = 0, s = (e, t, n, i, a) => {
		e.forEach((s, l) => {
			let u = i ?? s.id, d = {
				id: s.id,
				block: s,
				siblings: e,
				index: l,
				parent: n,
				top: u,
				section: t,
				...a,
				seq: o++,
				last: 0
			};
			r.has(s.id) || r.set(s.id, d), c(s, t, u), d.last = o - 1;
		});
	}, c = (e, t, r) => {
		n(e) ? a.has(e.id) || (a.set(e.id, i.length), i.push(e)) : e.type === "quote" || e.type === "container" ? s(e.blocks, t, e.id, r, {}) : e.type === "list" ? e.items.forEach((n, i) => s(n.blocks, t, e.id, r, { item: {
			list: e.id,
			index: i,
			id: n.id
		} })) : e.type === "table" && e.rows.forEach((n, i) => n.cells.forEach((n, a) => s(n.blocks, t, e.id, r, { cell: {
			table: e.id,
			row: i,
			col: a,
			id: n.id
		} })));
	};
	e.sections.forEach((e, t) => s(e.blocks, t, void 0, void 0, {}));
	let l = {
		doc: e,
		blocks: r,
		texts: i,
		order: a
	};
	return ve.set(e, l), l;
}
function N(e, t) {
	let r = e.blocks.get(t);
	return r && n(r.block) ? r.block : void 0;
}
function P(t, n) {
	let r = N(t, n);
	return r ? r.inlines.reduce((t, n) => t + e(n), 0) : 0;
}
function ye(e, n) {
	let r = N(e, n);
	return r ? t(r.inlines) : "";
}
function F(e, t, n) {
	let r = e.order.get(t.node) ?? Infinity, i = e.order.get(n.node) ?? Infinity;
	return r === i ? t.offset - n.offset : r - i;
}
function I(e, t) {
	if (e.order.has(t.node)) return {
		node: t.node,
		offset: Math.max(0, Math.min(t.offset, P(e, t.node)))
	};
}
function L(t, n, r = Infinity) {
	let i = [], a = 0;
	for (let o of t) {
		let t = e(o), s = Math.max(n, a), c = Math.min(r, a + t);
		if (o.type === "run") {
			if (c > s) {
				let e = Array.from(o.text).slice(s - a, c - a).join("");
				i.push(e === o.text ? o : {
					...o,
					text: e
				});
			}
		} else s < c && i.push(o);
		if (a += t, a >= r) break;
	}
	return i;
}
function be(t, n, r) {
	let i = 0;
	for (let a of t) {
		let t = e(a);
		if (r < 0 ? n > i && n <= i + t : n >= i && n < i + t) return a.type === "run" ? a.props ?? {} : void 0;
		i += t;
	}
}
// packages/vue/src/docs-editor/commands.ts
var xe = class {
	before;
	doc;
	ops = [];
	inverse = [];
	steps = [];
	selection;
	marks;
	keepMarks = !1;
	options;
	constructor(e, t = {}) {
		this.before = e, this.doc = e, this.options = t;
	}
	step(e, t) {
		let n = j(this.doc, e, this.ops.length, this.options);
		return this.doc = n.doc, this.ops.push(e), this.inverse.unshift(...n.inverse), this.steps.push(...t ?? n.steps), this;
	}
	get index() {
		return M(this.doc);
	}
	get changed() {
		return this.ops.length > 0;
	}
}, R = (e) => ({
	anchor: e,
	focus: e
}), Se = (e) => e.anchor.node === e.focus.node && e.anchor.offset === e.focus.offset;
function z(e, t) {
	if (!t || !e.order.has(t.anchor.node) || !e.order.has(t.focus.node)) return;
	let n = F(e, t.anchor, t.focus) <= 0;
	return {
		from: n ? t.anchor : t.focus,
		to: n ? t.focus : t.anchor,
		collapsed: Se(t)
	};
}
function B(e) {
	let t = z(M(e.doc), e.selection);
	if (t) return {
		tr: new xe(e.doc, { constraints: e.constraints }),
		...t
	};
}
function V(e) {
	if (!e) return;
	let t = Object.entries(e).filter(([, e]) => e != null);
	return t.length ? Object.fromEntries(t) : void 0;
}
function H(e, t) {
	let { props: n, ...r } = e, i = V(t);
	return i ? {
		...r,
		props: i
	} : r;
}
function U(e) {
	if (!e) return;
	let { listLabel: t, pageBreakBefore: n, ...r } = e;
	return V(r);
}
function W(e, t, r) {
	if (t.node === r.node) return r.offset > t.offset && e.step({
		op: "doc.replace_text",
		id: t.node,
		range: {
			start: t.offset,
			end: r.offset
		},
		text: ""
	}), t;
	let i = e.index, a = i.blocks.get(t.node), o = i.blocks.get(r.node), s = a.block, c = o.block, l = P(i, t.node), u = P(i, r.node), d = [];
	for (let e of i.blocks.values()) e.seq > a.seq && e.last < o.seq && d.push(e);
	let f = new Set(d.map((e) => e.id)), p = d.filter((e) => !e.parent || !f.has(e.parent)), m = a.siblings === o.siblings;
	if (m) {
		let n = L(c.inlines, r.offset);
		e.step({
			op: "doc.set_inlines",
			id: t.node,
			inlines: [...L(s.inlines, 0, t.offset), ...n]
		}, [
			{
				kind: "text",
				node: t.node,
				start: t.offset,
				end: l,
				insert: 0
			},
			{
				kind: "text",
				node: r.node,
				start: 0,
				end: r.offset,
				insert: 0
			},
			{
				kind: "move",
				from: r.node,
				start: 0,
				end: u - r.offset,
				to: t.node,
				at: t.offset,
				whole: !0
			}
		]);
	} else t.offset < l && e.step({
		op: "doc.replace_text",
		id: t.node,
		range: {
			start: t.offset,
			end: l
		},
		text: ""
	}), r.offset > 0 && e.step({
		op: "doc.replace_text",
		id: r.node,
		range: {
			start: 0,
			end: r.offset
		},
		text: ""
	});
	let h = /* @__PURE__ */ new Map();
	for (let e of p) {
		let t = h.get(e.siblings) ?? [];
		t.push(e), h.set(e.siblings, t);
	}
	for (let [t, r] of h) {
		let a;
		if (!(r.length === t.length && (a = r.find((e) => n(e.block)), !a))) for (let t of r) if (t === a) {
			let n = P(i, t.id);
			n && e.step({
				op: "doc.replace_text",
				id: t.id,
				range: {
					start: 0,
					end: n
				},
				text: ""
			});
		} else e.step({
			op: "doc.delete_block",
			id: t.id
		});
	}
	return m && e.step({
		op: "doc.delete_block",
		id: r.node
	}), t;
}
function Ce(e, t, n) {
	let r = M(e.doc);
	if (!r.order.has(t.node) || !r.order.has(n.node)) return null;
	let [i, a] = F(r, t, n) <= 0 ? [t, n] : [n, t];
	if (i.node === a.node && i.offset === a.offset) return null;
	let o = new xe(e.doc, { constraints: e.constraints });
	return o.selection = R(W(o, i, a)), o;
}
var we = (e) => !!e && "other" in e && e.other.type === "bookmark";
function Te(e, t) {
	let n = [], r = 0;
	if (typeof Intl < "u" && typeof Intl.Segmenter == "function") {
		let i = new Intl.Segmenter(void 0, { granularity: t === "word" ? "word" : "grapheme" });
		for (let t of i.segment(e)) {
			let e = Array.from(t.segment).length;
			n.push({
				start: r,
				end: r + e,
				word: t.isWordLike ?? !/^\s+$/.test(t.segment)
			}), r += e;
		}
	} else for (let t of e) n.push({
		start: r,
		end: r + 1,
		word: !/\s/.test(t)
	}), r++;
	return n;
}
function Ee(e, t, n, r) {
	let i = g(e), a = n < 0 ? t - 1 : t;
	for (; a >= 0 && a < i.length && we(i[a]);) a += n;
	if (a < 0 || a >= i.length) return;
	if ("other" in i[a]) return {
		start: a,
		end: a + 1
	};
	let o = a, s = a + 1;
	for (; o > 0 && "ch" in i[o - 1];) o--;
	for (; s < i.length && "ch" in i[s];) s++;
	let c = Te(i.slice(o, s).map((e) => "ch" in e ? e.ch : "").join(""), r), l = a - o, u = c.findIndex((e) => e.start <= l && l < e.end);
	if (u < 0) return {
		start: a,
		end: a + 1
	};
	let d = c[u].start, f = c[u].end;
	if (r === "word") {
		if (n < 0) {
			for (; u > 0 && !c[u].word;) d = c[--u].start;
			f = l + 1;
		} else {
			for (; u < c.length - 1 && !c[u].word;) f = c[++u].end;
			d = l;
		}
	}
	return {
		start: o + d,
		end: o + f
	};
}
function De(e, t) {
	let n = e.order.get(t);
	return n ? e.texts[n - 1] : void 0;
}
function Oe(e, t) {
	let n = e.order.get(t);
	return n == null ? void 0 : e.texts[n + 1];
}
function ke(e, t, n) {
	let r = e.index, i = P(r, t.id), a = P(r, n.id);
	return !i && a ? (e.step({
		op: "doc.delete_block",
		id: t.id
	}, [{
		kind: "remove",
		node: t.id,
		fallback: {
			node: n.id,
			offset: 0
		}
	}]), {
		node: n.id,
		offset: 0
	}) : (e.step({
		op: "doc.set_inlines",
		id: t.id,
		inlines: [...t.inlines, ...n.inlines]
	}, [{
		kind: "move",
		from: n.id,
		start: 0,
		end: a,
		to: t.id,
		at: i,
		whole: !0
	}]), e.step({
		op: "doc.delete_block",
		id: n.id
	}, [{
		kind: "remove",
		node: n.id,
		fallback: {
			node: t.id,
			offset: i
		}
	}]), {
		node: t.id,
		offset: i
	});
}
function Ae(e, t) {
	let r = e.index, i = r.blocks.get(t), a = i.block;
	if (a.props?.listLabel) {
		let { listLabel: n, ...r } = a.props;
		return e.step({
			op: "doc.replace_block",
			id: t,
			block: H(a, r)
		}), {
			node: t,
			offset: 0
		};
	}
	if (i.index === 0) return;
	let o = i.siblings[i.index - 1];
	if (n(o)) return ke(e, o, a);
	let s = De(r, t);
	if (s) return !P(r, t) && i.siblings.length > 1 && e.step({
		op: "doc.delete_block",
		id: t
	}), {
		node: s.id,
		offset: P(r, s.id)
	};
}
function je(e, t) {
	let r = e.index, i = r.blocks.get(t), a = i.block, o = P(r, t), s = i.siblings[i.index + 1];
	if (!s) return;
	if (n(s)) {
		let n = ke(e, a, s);
		return n.node === t ? {
			node: t,
			offset: o
		} : n;
	}
	let c = Oe(r, t);
	if (c) return !o && i.siblings.length > 1 && e.step({
		op: "doc.delete_block",
		id: t
	}), {
		node: c.id,
		offset: 0
	};
}
function Me(e, t = "char") {
	return Pe(e, -1, t);
}
function Ne(e, t = "char") {
	return Pe(e, 1, t);
}
function Pe(e, t, n) {
	let r = B(e);
	if (!r) return null;
	let { tr: i, from: a, to: o } = r;
	if (!r.collapsed) return i.selection = R(W(i, a, o)), i;
	let s = N(i.index, a.node), c = Ee(s.inlines, a.offset, t, n);
	if (c) return i.step({
		op: "doc.replace_text",
		id: s.id,
		range: c,
		text: ""
	}), i.selection = R({
		node: s.id,
		offset: t < 0 ? c.start : a.offset
	}), i;
	let l = t < 0 ? Ae(i, s.id) : je(i, s.id);
	return l ? (i.selection = R(l), i) : null;
}
function G(e) {
	return (typeof e.toWellFormed == "function" ? e.toWellFormed() : e).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}
function K(e, t, n) {
	if (n) return V(n);
	let r = be(e.inlines, t, -1), i = be(e.inlines, t, 1), a = r ?? i;
	if (a?.link && !(r && i && m(r.link, i.link))) {
		let { link: e, ...t } = a;
		return V(t);
	}
	return V(a);
}
function Fe(e, t, n, r) {
	let i = N(e.index, t.node);
	if (!i) return 0;
	let a = g(i.inlines), o = K(i, t.offset, r), s = [], c = !0;
	for (let e of G(n)) {
		if (e === "	") s.push({ other: { type: "tab" } });
		else if (e === "\n") s.push({ other: {
			type: "break",
			kind: "line"
		} });
		else {
			s.push({
				ch: e,
				props: o
			});
			continue;
		}
		c = !1;
	}
	if (!s.length) return 0;
	let l = t.offset < a.length ? a[t.offset] : a[Math.max(0, t.offset - 1)], u = l && "ch" in l ? l.props : void 0;
	return c && m(u, o) ? e.step({
		op: "doc.replace_text",
		id: i.id,
		range: {
			start: t.offset,
			end: t.offset
		},
		text: s.map((e) => "ch" in e ? e.ch : "").join("")
	}) : (a.splice(t.offset, 0, ...s), e.step({
		op: "doc.set_inlines",
		id: i.id,
		inlines: _(a)
	}, [{
		kind: "text",
		node: i.id,
		start: t.offset,
		end: t.offset,
		insert: s.length
	}])), s.length;
}
function q(e, t) {
	let n = B(e);
	if (!n) return null;
	let { tr: r } = n, i = n.collapsed ? n.from : W(r, n.from, n.to), a = Fe(r, i, t, e.marks);
	return r.changed ? (r.selection = R({
		node: i.node,
		offset: i.offset + a
	}), r.keepMarks = !!e.marks && n.collapsed, r.keepMarks && (r.marks = e.marks), r) : null;
}
function Ie(e, t, n, r) {
	return q({
		...e,
		selection: {
			anchor: t,
			focus: n
		}
	}, r);
}
function Le(e) {
	let t = (e) => !!e && e.type === "paragraph" && !e.props?.listLabel;
	for (let n = e.index + 1; n < e.siblings.length; n++) if (t(e.siblings[n])) return e.siblings[n];
	for (let n = e.index - 1; n >= 0; n--) if (t(e.siblings[n])) return e.siblings[n];
}
function Re(e) {
	let t = B(e);
	if (!t) return null;
	let { tr: n } = t, r = t.collapsed ? t.from : W(n, t.from, t.to), i = n.index, a = i.blocks.get(r.node), o = a.block, s = P(i, o.id);
	if (o.props?.listLabel && !s) {
		let { listLabel: e, ...t } = o.props;
		return n.step({
			op: "doc.replace_block",
			id: o.id,
			block: H(o, t)
		}), n.selection = R(r), n;
	}
	let c = e.newId(), l = r.offset >= s, u, d;
	if (o.type === "heading" && l && s) {
		let e = Le(a);
		u = H({
			type: "paragraph",
			id: c,
			inlines: []
		}, U(e?.props));
		let t = e?.inlines.find((e) => e.type === "run");
		d = t?.type === "run" ? t.props : void 0;
	} else u = H({
		...o,
		id: c,
		inlines: L(o.inlines, r.offset)
	}, U(o.props)), l && (d = be(o.inlines, r.offset, -1));
	return n.step({
		op: "doc.insert_block",
		at: {
			kind: "after",
			id: o.id
		},
		block: u
	}, [{
		kind: "move",
		from: o.id,
		start: r.offset,
		end: s,
		to: c,
		at: 0
	}]), l || n.step({
		op: "doc.replace_text",
		id: o.id,
		range: {
			start: r.offset,
			end: s
		},
		text: ""
	}), n.selection = R({
		node: c,
		offset: 0
	}), n.marks = V(d) ?? null, n.keepMarks = !!V(d), n;
}
function J(t, n, r) {
	let i = t.order.get(n.node), a = t.order.get(r.node), o = [];
	for (let s = i; s <= a; s++) {
		let c = t.texts[s], l = c.inlines.reduce((t, n) => t + e(n), 0);
		o.push({
			block: c,
			start: s === i ? n.offset : 0,
			end: s === a ? r.offset : l
		});
	}
	return o;
}
function ze(e, t) {
	let n = B(e);
	if (!n) return null;
	let { tr: r, from: i, to: a } = n;
	if (n.collapsed) return r.marks = v(K(N(r.index, i.node), i.offset, e.marks), t) ?? {}, r.keepMarks = !0, r.selection = e.selection, r;
	for (let e of J(r.index, i, a)) e.end > e.start && r.step({
		op: "doc.set_run_props",
		id: e.block.id,
		range: {
			start: e.start,
			end: e.end
		},
		props: t
	});
	return r.selection = e.selection, r.changed ? r : null;
}
var Be = {
	bold: (e) => e.bold === !0,
	italic: (e) => e.italic === !0,
	underline: (e) => !!e.underline && e.underline !== "none",
	strike: (e) => e.strike === !0,
	superscript: (e) => e.verticalAlign === "superscript",
	subscript: (e) => e.verticalAlign === "subscript"
}, Ve = {
	bold: { bold: !0 },
	italic: { italic: !0 },
	underline: { underline: "single" },
	strike: { strike: !0 },
	superscript: { verticalAlign: "superscript" },
	subscript: { verticalAlign: "subscript" }
}, He = {
	bold: { bold: !1 },
	italic: { italic: !1 },
	underline: { underline: "none" },
	strike: { strike: !1 },
	superscript: { verticalAlign: "baseline" },
	subscript: { verticalAlign: "baseline" }
};
function Ue(e) {
	if (e.length) return e.every((t) => m(t, e[0])) ? e[0] : "mixed";
}
function Y(t) {
	let n = M(t.doc), r = z(n, t.selection);
	if (!r) return null;
	let i = J(n, r.from, r.to), a = [];
	if (r.collapsed) {
		let e = i[0].block;
		a.push(v(e.props?.run, K(e, r.from.offset, t.marks)) ?? {});
	} else for (let t of i) {
		let n = 0;
		for (let r of t.block.inlines) {
			let i = e(r);
			r.type === "run" && n < t.end && n + i > t.start && a.push(v(t.block.props?.run, r.props) ?? {}), n += i;
		}
	}
	let o = (e) => {
		if (!a.length) return !1;
		let t = a.map(Be[e]);
		return t.every(Boolean) ? !0 : t.some(Boolean) ? "mixed" : !1;
	}, s = i.map((e) => e.block), c = Ue(s.map((e) => e.type === "heading" ? e.level : 0));
	return {
		bold: o("bold"),
		italic: o("italic"),
		underline: o("underline"),
		strike: o("strike"),
		superscript: o("superscript"),
		subscript: o("subscript"),
		align: Ue(s.map((e) => e.props?.align)),
		heading: c ?? 0,
		style: Ue(s.map((e) => e.props?.style)),
		inTable: !!n.blocks.get(r.from.node)?.cell
	};
}
function We(e, t) {
	let n = Y(e);
	return n ? ze(e, n[t] === !0 ? He[t] : Ve[t]) : null;
}
function X(e) {
	let t = B(e);
	if (!t) return;
	let n = J(t.tr.index, t.from, t.to).map((e) => e.block);
	return t.tr.selection = e.selection, t.tr.marks = e.marks, t.tr.keepMarks = !0, {
		tr: t.tr,
		blocks: n
	};
}
function Ge(e, t) {
	let n = X(e);
	return n ? (n.tr.step({
		op: "doc.set_para_props",
		ids: n.blocks.map((e) => e.id),
		props: t
	}), n.tr) : null;
}
function Ke(e, t) {
	let n = X(e);
	return n ? (n.tr.step({
		op: "doc.apply_style",
		ids: n.blocks.map((e) => e.id),
		style: t
	}), n.tr) : null;
}
function qe(e, t) {
	let n = X(e);
	if (!n) return null;
	for (let e of n.blocks) if (t >= 1 && t <= 6) (e.type !== "heading" || e.level !== t) && n.tr.step({
		op: "doc.set_heading_level",
		id: e.id,
		level: t
	});
	else if (e.type === "heading") {
		let { level: t, type: r, ...i } = e;
		n.tr.step({
			op: "doc.replace_block",
			id: e.id,
			block: {
				...i,
				type: "paragraph"
			}
		});
	}
	return n.tr.changed ? n.tr : null;
}
function Je(e, t, n = 266700) {
	let r = X(e);
	if (!r) return null;
	for (let e of r.blocks) {
		let i = e.props?.indent ?? {}, a = i.startChars != null, o = a ? i.startChars : i.start ?? 0, s = Math.max(0, o + t * (a ? 200 : n));
		s !== o && r.tr.step({
			op: "doc.set_para_props",
			ids: [e.id],
			props: { indent: a ? { startChars: s } : { start: s } }
		});
	}
	return r.tr.changed ? r.tr : null;
}
function Ye(e) {
	let t = B(e);
	if (!t) return null;
	let { tr: n } = t;
	for (let e of J(n.index, t.from, t.to)) {
		let r = t.collapsed || e.start === 0 && e.end >= P(n.index, e.block.id), i = t.collapsed ? 0 : e.start, a = t.collapsed ? Infinity : e.end, o = 0, s = g(e.block.inlines).map((e) => {
			let t = o >= i && o < a;
			return o++, !t || !("ch" in e) || !e.props ? e : {
				ch: e.ch,
				props: e.props.link ? { link: e.props.link } : void 0
			};
		}), c = r ? V({
			style: e.block.props?.style,
			listLabel: e.block.props?.listLabel
		}) : e.block.props, l = H({
			...e.block,
			inlines: _(s)
		}, c);
		m(l, e.block) || n.step({
			op: "doc.replace_block",
			id: e.block.id,
			block: l
		});
	}
	return n.selection = e.selection, n.changed ? n : null;
}
function Xe(t, n) {
	let r = B(t);
	if (!r || !n.length) return null;
	let { tr: i } = r, a = r.collapsed ? r.from : W(i, r.from, r.to), o = N(i.index, a.node), s = K(o, a.offset, t.marks), c = (e) => e.map((e) => {
		if (e.type !== "run") return e;
		let t = v(s, e.props);
		return t ? {
			...e,
			props: t
		} : {
			type: "run",
			text: e.text
		};
	}), l = L(o.inlines, 0, a.offset), u = L(o.inlines, a.offset), d = P(i.index, o.id), f = (t) => t.reduce((t, n) => t + e(n), 0), p = c(n[0].inlines);
	if (n.length === 1) return i.step({
		op: "doc.set_inlines",
		id: o.id,
		inlines: _(g([
			...l,
			...p,
			...u
		]))
	}, [{
		kind: "text",
		node: o.id,
		start: a.offset,
		end: a.offset,
		insert: f(p)
	}]), i.selection = R({
		node: o.id,
		offset: a.offset + f(p)
	}), i;
	let m = t.newId(), h = c(n[n.length - 1].inlines);
	i.step({
		op: "doc.set_inlines",
		id: o.id,
		inlines: _(g([...l, ...p]))
	}, [{
		kind: "move",
		from: o.id,
		start: a.offset,
		end: d,
		to: m,
		at: f(h)
	}, {
		kind: "text",
		node: o.id,
		start: a.offset,
		end: a.offset,
		insert: f(p)
	}]);
	let y = o.id, ee = (e, t, n) => {
		let r = U(e.props ?? o.props), i = e.props ? e.heading : o.type === "heading" ? o.level : void 0;
		return H(i ? {
			type: "heading",
			id: t,
			level: i,
			inlines: n
		} : {
			type: "paragraph",
			id: t,
			inlines: n
		}, r);
	};
	return n.slice(1).forEach((e, r) => {
		let a = r === n.length - 2, o = a ? m : t.newId(), s = _(g(a ? [...h, ...u] : c(e.inlines)));
		i.step({
			op: "doc.insert_block",
			at: {
				kind: "after",
				id: y
			},
			block: ee(e, o, s)
		}, []), y = o;
	}), i.selection = R({
		node: m,
		offset: f(h)
	}), i;
}
function Ze(e) {
	return G(e).split("\n").map((e) => ({ inlines: e ? [{
		type: "run",
		text: e
	}] : [] }));
}
function Qe(e) {
	let t = M(e.doc), n = z(t, e.selection);
	return !n || n.collapsed ? [] : J(t, n.from, n.to).map((e) => ({
		inlines: L(e.block.inlines, e.start, e.end),
		props: e.block.props,
		heading: e.block.type === "heading" ? e.block.level : void 0
	}));
}
function Z(e, t) {
	let n = e.blocks.get(t);
	if (n?.cell) return {
		table: e.blocks.get(n.cell.table).block,
		row: n.cell.row,
		col: n.cell.col
	};
}
var Q = (e) => e.rows.some((e) => e.cells.some((e) => (e.rowSpan ?? 1) > 1));
function $(e) {
	for (let t of e) {
		if (n(t)) return t;
		let e = t.type === "quote" || t.type === "container" ? $(t.blocks) : t.type === "list" ? $(t.items.flatMap((e) => e.blocks)) : t.type === "table" ? $(t.rows.flatMap((e) => e.cells.flatMap((e) => e.blocks))) : void 0;
		if (e) return e;
	}
}
function $e(e, t) {
	return {
		id: t(),
		...e.height == null ? {} : { height: e.height },
		cells: e.cells.map((e) => {
			let n = $(e.blocks), r = H({
				type: "paragraph",
				id: t(),
				inlines: []
			}, U(n?.props));
			return {
				id: t(),
				...e.colSpan == null ? {} : { colSpan: e.colSpan },
				...e.props ? { props: e.props } : {},
				blocks: [r]
			};
		})
	};
}
function et(e, t) {
	let n = B(e);
	if (!n) return null;
	let r = Z(n.tr.index, n.from.node);
	if (!r || Q(r.table)) return null;
	let i = $e(r.table.rows[r.row], e.newId), a = r.table.rows.slice();
	a.splice(t === "above" ? r.row : r.row + 1, 0, i), n.tr.step({
		op: "doc.replace_block",
		id: r.table.id,
		block: {
			...r.table,
			rows: a
		}
	});
	let o = $(i.cells[Math.min(r.col, i.cells.length - 1)].blocks);
	return n.tr.selection = R({
		node: o.id,
		offset: 0
	}), n.tr;
}
function tt(e) {
	let t = B(e);
	if (!t) return null;
	let n = Z(t.tr.index, t.from.node);
	if (!n || Q(n.table) || n.table.rows.length < 2) return null;
	let r = n.table.rows[n.row + 1] ?? n.table.rows[n.row - 1], i = $(r.cells[Math.min(n.col, r.cells.length - 1)].blocks);
	return t.tr.step({
		op: "doc.table.delete_row",
		table: n.table.id,
		row: n.row
	}), t.tr.selection = i ? R({
		node: i.id,
		offset: 0
	}) : null, t.tr;
}
function nt(t, n) {
	let r = B(t);
	if (!r) return null;
	let { tr: i } = r, a = Z(i.index, t.selection.focus.node);
	if (!a) return null;
	let o = a.table.rows.flatMap((e) => e.cells), s = o[o.indexOf(a.table.rows[a.row].cells[a.col]) + n];
	if (!s) {
		if (n < 0 || Q(a.table)) return null;
		let e = $e(a.table.rows[a.table.rows.length - 1], t.newId);
		i.step({
			op: "doc.replace_block",
			id: a.table.id,
			block: {
				...a.table,
				rows: [...a.table.rows, e]
			}
		}), s = e.cells[0];
	}
	let c = $(s.blocks);
	if (!c) return null;
	let l = c.inlines.reduce((t, n) => t + e(n), 0);
	return i.selection = {
		anchor: {
			node: c.id,
			offset: 0
		},
		focus: {
			node: c.id,
			offset: l
		}
	}, i;
}
function rt(e) {
	let t = M(e.doc), n = z(t, e.selection), r = n ? Z(t, n.from.node) : void 0, i = !!r && !Q(r.table);
	return {
		inTable: !!r,
		insertRow: i,
		deleteRow: i && r.table.rows.length > 1,
		insertColumn: !1,
		deleteColumn: !1,
		mergeCells: !1,
		splitCell: !1
	};
}
// packages/vue/src/docs-editor/controller.ts
var it = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function at(e = Date.now()) {
	let t = "", n = e;
	for (let e = 0; e < 10; e++) t = it[n % 32] + t, n = Math.floor(n / 32);
	let r = /* @__PURE__ */ new Uint8Array(16), i = globalThis.crypto;
	if (i?.getRandomValues) i.getRandomValues(r);
	else for (let e = 0; e < r.length; e++) r[e] = Math.floor(Math.random() * 256);
	for (let e = 0; e < 16; e++) t += it[r[e] % 32];
	return t;
}
var ot = (e, t) => e === t || !!e && !!t && e.anchor.node === t.anchor.node && e.anchor.offset === t.anchor.offset && e.focus.node === t.focus.node && e.focus.offset === t.focus.offset, st = 1500, ct = [
	"bold",
	"italic",
	"underline",
	"strike",
	"superscript",
	"subscript"
], lt = class {
	doc;
	selection = null;
	marks = null;
	readOnly;
	options;
	protectedRanges = [];
	undoStack = [];
	redoStack = [];
	savedDepth = 0;
	seq = 0;
	constructor(e) {
		this.options = e, this.doc = e.doc, this.readOnly = !!e.readOnly;
	}
	configure(e) {
		this.options = {
			...this.options,
			...e
		};
	}
	context() {
		return {
			doc: this.doc,
			selection: this.selection,
			marks: this.marks,
			newId: this.options.newId ?? at,
			constraints: this.options.constraints
		};
	}
	setDoc(e, t = {}) {
		e !== this.doc && (this.doc = e, t.history || this.clearHistory(), this.selection = this.clampSelection(this.selection), this.marks = null, this.options.onState?.());
	}
	clampSelection(e) {
		if (!e) return null;
		let t = M(this.doc), n = I(t, e.anchor), r = I(t, e.focus);
		return n && r ? {
			anchor: n,
			focus: r
		} : null;
	}
	setSelection(e) {
		let t = this.clampSelection(e);
		ot(t, this.selection) || (this.selection = t, this.marks = null, this.options.onState?.());
	}
	setProtectedRanges(e) {
		this.protectedRanges = e.map((e) => ({ ...e }));
	}
	get protected() {
		return this.protectedRanges;
	}
	get state() {
		return Y(this.context());
	}
	get canUndo() {
		return !this.readOnly && this.undoStack.length > 0;
	}
	get canRedo() {
		return !this.readOnly && this.redoStack.length > 0;
	}
	get dirty() {
		return this.savedDepth !== this.undoStack.length;
	}
	markSaved() {
		this.savedDepth = this.undoStack.length;
		let e = this.undoStack[this.undoStack.length - 1];
		e && (e.key = void 0), this.options.onState?.();
	}
	clearHistory() {
		this.undoStack = [], this.redoStack = [], this.savedDepth = 0;
	}
	violation(e, t, n) {
		if (!this.protectedRanges.length) return;
		let r = this.options.protectFormatting !== !1, i = M(e), a = M(t), o = (e, t, n) => {
			let i = _(g(L(e, t, n)));
			return r ? i : i.map((e) => e.type === "run" ? {
				type: "run",
				text: e.text
			} : e);
		};
		for (let e of this.protectedRanges) for (let t of [e.anchor, ...e.anchor.segments ?? []]) {
			let r = i.blocks.get(t.node);
			if (!r) continue;
			if (t.start == null || t.end == null) {
				let n = a.blocks.get(t.node);
				if (!n || n.block !== r.block && !m(n.block, r.block)) return e;
				continue;
			}
			let s = N(i, t.node);
			if (!s) continue;
			let c = me({
				node: t.node,
				start: t.start,
				end: t.end
			}, n);
			if (!c.intact || c.segments.length !== 1) return e;
			let l = N(a, c.segments[0].node);
			if (!l || (l !== s || c.segments[0].start !== t.start) && !m(o(s.inlines, t.start, t.end), o(l.inlines, c.segments[0].start, c.segments[0].end))) return e;
		}
	}
	mapProtected(e) {
		e.length && this.protectedRanges.length && (this.protectedRanges = this.protectedRanges.flatMap((t) => {
			let n = _e(t.anchor, e);
			return n ? [{
				...t,
				anchor: n
			}] : [];
		}));
	}
	blocked(e) {
		return this.options.onBlocked?.(e), !1;
	}
	run(e, t) {
		if (this.readOnly) return this.blocked({
			rangeId: "",
			kind: "readonly",
			source: t.source,
			intent: t.intent
		});
		let n;
		try {
			n = e(this.context());
		} catch (e) {
			if (!(e instanceof r)) throw e;
			return this.blocked({
				rangeId: "",
				kind: "constraint",
				source: t.source,
				intent: t.intent,
				message: e.message
			});
		}
		if (!n) return !1;
		let i = this.selection, a = n.selection === void 0 ? this.mapped(n) : this.clampTo(n.doc, n.selection);
		if (n.changed) {
			if (!this.commit(n.doc, n.ops, n.inverse, n.steps, i, a, t)) return !1;
			this.pushHistory({
				ops: n.ops,
				inverse: n.inverse,
				steps: n.steps,
				before: i,
				after: a,
				key: t.coalesce
			});
		}
		return this.selection = a, this.marks = n.keepMarks ? n.marks ?? null : n.changed ? null : this.marks, this.options.onState?.(), !0;
	}
	clampTo(e, t) {
		if (!t) return null;
		let n = M(e), r = I(n, t.anchor), i = I(n, t.focus);
		return r && i ? {
			anchor: r,
			focus: i
		} : null;
	}
	mapped(e) {
		if (!this.selection) return null;
		let t = pe(this.selection.anchor, e.steps, 1), n = pe(this.selection.focus, e.steps, 1);
		return t && n ? this.clampTo(e.doc, {
			anchor: t,
			focus: n
		}) : null;
	}
	commit(e, t, n, r, i, a, o) {
		let s = this.violation(this.doc, e, r);
		if (s) return this.blocked({
			rangeId: s.id,
			kind: s.kind,
			source: o.source,
			intent: o.intent
		});
		let c = {
			txn: t,
			mode: "apply",
			actor: this.options.actor ?? "user:local",
			reason: o.intent
		}, l = {
			source: o.source,
			intent: o.intent,
			seq: ++this.seq,
			steps: r,
			inverse: n,
			selectionBefore: i,
			selectionAfter: a,
			docBefore: this.doc,
			docAfter: e
		};
		return this.options.beforeTransaction?.(c, l) === !1 ? (this.seq--, this.blocked({
			rangeId: "",
			kind: "host",
			source: o.source,
			intent: o.intent
		})) : (this.doc = e, this.mapProtected(r), this.options.onTransaction?.(c, l), !0);
	}
	pushHistory(e) {
		let t = (this.options.now ?? Date.now)(), n = this.undoStack[this.undoStack.length - 1];
		if (this.redoStack = [], this.savedDepth > this.undoStack.length && (this.savedDepth = -1), n && e.key && n.key === e.key && t - n.time < st && this.savedDepth !== this.undoStack.length && ot(n.after, e.before)) {
			n.ops = [...n.ops, ...e.ops], n.inverse = [...e.inverse, ...n.inverse], n.steps = [...n.steps, ...e.steps], n.after = e.after, n.time = t;
			return;
		}
		this.undoStack.push({
			...e,
			time: t
		});
		let r = this.options.historyLimit ?? 200;
		this.undoStack.length > r && (this.undoStack.shift(), this.savedDepth >= 0 && this.savedDepth--);
	}
	travel(e) {
		if (this.readOnly) return !1;
		let t = e === "undo" ? this.undoStack : this.redoStack, n = e === "undo" ? this.redoStack : this.undoStack, i = t[t.length - 1];
		if (!i) return !1;
		let a = e === "undo" ? i.inverse : i.ops, o;
		try {
			o = fe(this.doc, a, { constraints: this.options.constraints });
		} catch (e) {
			if (!(e instanceof r)) throw e;
			return this.clearHistory(), this.options.onState?.(), !1;
		}
		let s = this.selection, c = this.clampTo(o.doc, e === "undo" ? i.before : i.after), l = {
			source: e,
			intent: e
		}, u = e === "undo" ? he(i.steps) : i.steps;
		return this.commit(o.doc, [...a], o.inverse, u, s, c, l) ? (t.pop(), i.key = void 0, n.push(i), this.selection = c, this.marks = null, this.options.onState?.(), !0) : !1;
	}
	undo() {
		return this.travel("undo");
	}
	redo() {
		return this.travel("redo");
	}
	insertText(e, t = "input") {
		return this.run((t) => q(t, e), {
			source: t,
			intent: "insertText",
			coalesce: t === "input" ? "type" : void 0
		});
	}
	replaceRange(e, t, n, r = "composition") {
		return this.run((r) => Ie(r, e, t, n), {
			source: r,
			intent: "replaceText"
		});
	}
	deleteRange(e, t, n = "input", r = "delete") {
		return this.run((n) => Ce(n, e, t), {
			source: n,
			intent: r
		});
	}
	deleteBackward(e = "char") {
		return this.run((t) => Me(t, e), {
			source: "input",
			intent: "deleteBackward",
			coalesce: "delete-backward"
		});
	}
	deleteForward(e = "char") {
		return this.run((t) => Ne(t, e), {
			source: "input",
			intent: "deleteForward",
			coalesce: "delete-forward"
		});
	}
	splitBlock() {
		return this.run(Re, {
			source: "input",
			intent: "splitBlock"
		});
	}
	slice() {
		return Qe(this.context());
	}
	paste(e, t = "paste") {
		return this.run((t) => Xe(t, e), {
			source: t,
			intent: "paste"
		});
	}
	cut() {
		let e = z(M(this.doc), this.selection);
		return !e || e.collapsed ? !1 : this.deleteRange(e.from, e.to, "cut", "cut");
	}
	selectAll() {
		let e = M(this.doc), t = e.texts[0], n = e.texts[e.texts.length - 1];
		return !t || !n ? !1 : (this.setSelection({
			anchor: {
				node: t.id,
				offset: 0
			},
			focus: {
				node: n.id,
				offset: P(e, n.id)
			}
		}), !0);
	}
	command(e, t) {
		if (ct.includes(e)) return (t) => We(t, e);
		switch (e) {
			case "runProps": return (e) => ze(e, t ?? {});
			case "align": return (e) => Ge(e, { align: t });
			case "indent": return (e) => Je(e, 1);
			case "outdent": return (e) => Je(e, -1);
			case "lineSpacing": return (e) => Ge(e, { spacing: { line: {
				kind: "multiple",
				value: Math.round(Number(t) * 1e3)
			} } });
			case "paraProps": return (e) => Ge(e, t ?? {});
			case "heading": return (e) => qe(e, Number(t) || 0);
			case "style": return (e) => Ke(e, String(t));
			case "clearFormatting": return Ye;
			case "insertText": return (e) => q(e, String(t ?? ""));
			case "insertParagraph": return Re;
			case "insertLineBreak": return (e) => q(e, "\n");
			case "insertTab": return (e) => q(e, "	");
			case "deleteBackward": return (e) => Me(e);
			case "deleteForward": return (e) => Ne(e);
			case "table.insertRowAbove": return (e) => et(e, "above");
			case "table.insertRowBelow": return (e) => et(e, "below");
			case "table.deleteRow": return tt;
			case "table.nextCell": return (e) => nt(e, 1);
			case "table.prevCell": return (e) => nt(e, -1);
			default: return;
		}
	}
	exec(e, t) {
		if (e === "undo") return this.undo();
		if (e === "redo") return this.redo();
		let n = this.command(e, t);
		return n ? this.run(n, {
			source: "command",
			intent: e
		}) : !1;
	}
	can(e) {
		if (e === "undo") return this.canUndo;
		if (e === "redo") return this.canRedo;
		if (this.readOnly || !z(M(this.doc), this.selection)) return !1;
		if (e.startsWith("table.")) {
			let t = rt(this.context());
			switch (e) {
				case "table.insertRowAbove":
				case "table.insertRowBelow": return t.insertRow;
				case "table.deleteRow": return t.deleteRow;
				case "table.nextCell":
				case "table.prevCell": return t.inTable;
				default: return !1;
			}
		}
		return e !== "list.toggle" && !!this.command(e, void 0);
	}
}, ut = "application/x-muffin-docs-slice+json";
function dt(e) {
	return e.map((e) => e.inlines.map((e) => e.type === "run" ? e.text : e.type === "tab" ? "	" : e.type === "break" ? "\n" : "").join("")).join("\n");
}
var ft = (e) => e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function pt(e, t) {
	let n = ft(e);
	return t && (t.bold && (n = `<b>${n}</b>`), t.italic && (n = `<i>${n}</i>`), t.underline && t.underline !== "none" && (n = `<u>${n}</u>`), t.strike && (n = `<s>${n}</s>`), t.verticalAlign === "superscript" && (n = `<sup>${n}</sup>`), t.verticalAlign === "subscript" && (n = `<sub>${n}</sub>`)), n;
}
function mt(e) {
	return e.map((e) => {
		let t = e.heading ? `h${e.heading}` : "p";
		return `<${t}>${e.inlines.map((e) => e.type === "run" ? pt(e.text, e.props) : e.type === "tab" ? "&#9;" : e.type === "break" ? "<br>" : "").join("")}</${t}>`;
	}).join("");
}
function ht(e) {
	return JSON.stringify({
		schema: "muffin-docs-slice/1",
		blocks: e.map((e) => ({
			...e,
			inlines: e.inlines.filter((e) => e.type === "run" || e.type === "tab" || e.type === "break")
		}))
	});
}
function gt(e) {
	try {
		let t = JSON.parse(e);
		if (t.schema !== "muffin-docs-slice/1" || !Array.isArray(t.blocks)) return;
		let n = t.blocks.filter((e) => e && Array.isArray(e.inlines)).map((e) => ({
			inlines: e.inlines.flatMap((e) => {
				if (e?.type === "tab") return [{ type: "tab" }];
				if (e?.type === "break") return [{
					type: "break",
					kind: "line"
				}];
				if (e?.type !== "run" || typeof e.text != "string") return [];
				let t = G(e.text).replace(/[\n\t]/g, " ");
				return [e.props ? {
					type: "run",
					text: t,
					props: e.props
				} : {
					type: "run",
					text: t
				}];
			}),
			...e.props ? { props: e.props } : {},
			...Number.isInteger(e.heading) ? { heading: e.heading } : {}
		}));
		return n.length ? n : void 0;
	} catch {
		return;
	}
}
var _t = /* @__PURE__ */ new Set([
	"P",
	"DIV",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"LI",
	"TR",
	"BLOCKQUOTE",
	"PRE",
	"SECTION",
	"ARTICLE",
	"TABLE",
	"UL",
	"OL",
	"DT",
	"DD"
]), vt = /* @__PURE__ */ new Set([
	"SCRIPT",
	"STYLE",
	"HEAD",
	"META",
	"LINK",
	"TITLE",
	"IMG",
	"SVG",
	"OBJECT",
	"IFRAME",
	"VIDEO",
	"AUDIO",
	"CANVAS",
	"TEMPLATE",
	"NOSCRIPT"
]);
function yt(e, t) {
	let n = { ...t }, r = (t) => RegExp(`(?:^|;)\\s*${t}\\s*:\\s*([^;]+)`, "i").exec(e)?.[1].trim().toLowerCase(), i = r("font-weight");
	i && (n.bold = i === "bold" || i === "bolder" || Number(i) >= 600);
	let a = r("font-style");
	a && (n.italic = a === "italic" || a === "oblique");
	let o = r("text-decoration(?:-line)?");
	o?.includes("underline") && (n.underline = "single"), o?.includes("line-through") && (n.strike = !0);
	let s = r("vertical-align");
	return s === "super" && (n.verticalAlign = "superscript"), s === "sub" && (n.verticalAlign = "subscript"), n;
}
function bt(e, t) {
	switch (e) {
		case "B":
		case "STRONG": return {
			...t,
			bold: !0
		};
		case "I":
		case "EM": return {
			...t,
			italic: !0
		};
		case "U":
		case "INS": return {
			...t,
			underline: "single"
		};
		case "S":
		case "STRIKE":
		case "DEL": return {
			...t,
			strike: !0
		};
		case "SUP": return {
			...t,
			verticalAlign: "superscript"
		};
		case "SUB": return {
			...t,
			verticalAlign: "subscript"
		};
		default: return t;
	}
}
var xt = (e) => {
	let t = Object.entries(e).filter(([, e]) => e !== !1 && e != null);
	return t.length ? Object.fromEntries(t) : void 0;
};
function St(e) {
	let t = [], n, r, i = () => n ??= [], a = () => {
		n && t.push({
			inlines: n,
			heading: r
		}), n = void 0, r = void 0;
	}, o = (e, t, r) => {
		let a = G(r ? e : e.replace(/\s+/g, " "));
		a && a.split("\n").forEach((e, a) => {
			if (a && i().push({
				type: "break",
				kind: "line"
			}), !e || !r && !n?.length && !e.trim()) return;
			let o = xt(t);
			i().push(o ? {
				type: "run",
				text: e,
				props: o
			} : {
				type: "run",
				text: e
			});
		});
	}, s = (e, t, c) => {
		if (e.nodeType === 3) return o(e.nodeValue ?? "", t, c);
		if (e.nodeType !== 1) return;
		let l = e.nodeName.toUpperCase();
		if (vt.has(l) || l.includes(":")) return;
		if (l === "BR") {
			i().push({
				type: "break",
				kind: "line"
			});
			return;
		}
		let u = _t.has(l);
		u && a();
		let d = /^H([1-6])$/.exec(l);
		d && (i(), r = Number(d[1]));
		let f = bt(l, t), p = e.getAttribute?.("style");
		p && (f = yt(p, f));
		for (let t = 0; t < e.childNodes.length; t++) {
			let r = e.childNodes[t];
			s(r, f, c || l === "PRE"), l === "TR" && r.nodeType === 1 && /^T[DH]$/i.test(r.nodeName) && t < e.childNodes.length - 1 && n?.length && n.push({ type: "tab" });
		}
		u && a();
	};
	s(e, {}, !1), a();
	for (let e of t) for (; e.inlines.length && e.inlines[e.inlines.length - 1].type !== "run";) e.inlines.pop();
	return t.filter((e, n) => e.inlines.length || n > 0 && n < t.length - 1);
}
export { fe as C, j as S, m as T, P as _, mt as a, me as b, at as c, z as d, Ze as f, M as g, F as h, ht as i, xe as l, ye as m, St as n, dt as o, G as p, gt as r, lt as s, ut as t, Y as u, _e as v, n as w, r as x, pe as y };
