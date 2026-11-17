// packages/vue/src/docs-anchors.ts
var e = "￼";
function t(e) {
	let t = 0;
	for (let n = 0; n < e.length; n++) {
		let r = e.charCodeAt(n);
		r >= 55296 && r <= 56319 && (e.charCodeAt(n + 1) & 64512) == 56320 && n++, t++;
	}
	return t;
}
function n(e) {
	return e.type === "run" ? e.text : e.type === "tab" ? "	" : e.type === "break" ? "\n" : "￼";
}
function r(e) {
	return e.type === "run" ? t(e.text) : 1;
}
function i(e) {
	return e.map(n).join("");
}
function a(e) {
	let t = 0;
	return e.map((e) => {
		let n = t;
		return t += r(e), n;
	});
}
var o = (e) => e >= 55296 && e <= 56319, s = (e) => (e & 64512) == 56320;
function c(e, t) {
	if (!Number.isInteger(t) || t < 0) return;
	let n = 0;
	for (let r = 0; r < t; r++) {
		if (n >= e.length) return;
		n += o(e.charCodeAt(n)) && s(e.charCodeAt(n + 1)) ? 2 : 1;
	}
	return n;
}
function l(e, t, n) {
	if (!Number.isInteger(t) || t < 0 || t > e.length) return;
	let r = 0;
	for (let i = 0; i < t;) {
		let a = o(e.charCodeAt(i)) && s(e.charCodeAt(i + 1)) ? 2 : 1;
		if (i + a > t) return n === "start" ? r : n === "end" ? r + 1 : void 0;
		i += a, r++;
	}
	return r;
}
function u(e, n, r, i) {
	return r === i ? Number.isInteger(n) && n >= 0 && n <= (r === "utf16" ? e.length : t(e)) ? n : void 0 : r === "scalar" ? c(e, n) : l(e, n);
}
function d(e, t, n) {
	let r = c(e, t) ?? e.length, i = c(e, n) ?? e.length;
	return e.slice(r, i);
}
function f(e) {
	let t = [];
	return e.map((n, r) => {
		let i = 0;
		return n.cells.map((n) => {
			for (; t[r]?.[i];) i++;
			let a = Math.max(1, n.colSpan ?? 1), o = Math.max(1, Math.min(n.rowSpan ?? 1, e.length - r));
			for (let e = r; e < r + o; e++) for (let n = i; n < i + a; n++) (t[e] ??= [])[n] = !0;
			let s = {
				row: r,
				col: i,
				rowSpan: o,
				colSpan: a
			};
			return i += a, s;
		});
	});
}
function p(e) {
	return e.type === "list" && e.items.every((e) => {
		let t = e.blocks[0];
		return (t?.type === "paragraph" || t?.type === "heading") && !!t.props?.listLabel;
	});
}
function m(e, t) {
	for (let n of e) switch (n.type) {
		case "paragraph":
		case "heading":
			t(n.id, "text", [], i(n.inlines));
			break;
		case "code_block":
			t(n.id, "text", [], n.text);
			break;
		case "list": {
			let e = p(n);
			t(n.id, "block", n.items.map((e) => e.id), void 0, e);
			for (let r of n.items) t(r.id, "item", r.blocks.map((e) => e.id), void 0, e), m(r.blocks, t);
			break;
		}
		case "table":
			t(n.id, "block", n.rows.map((e) => e.id));
			for (let e of n.rows) {
				t(e.id, "row", e.cells.map((e) => e.id));
				for (let n of e.cells) t(n.id, "cell", n.blocks.map((e) => e.id)), m(n.blocks, t);
			}
			break;
		case "quote":
		case "container":
			t(n.id, "block", n.blocks.map((e) => e.id)), m(n.blocks, t);
			break;
		case "page_break":
			t(n.id, "hidden", []);
			break;
		default: t(n.id, "block", []);
	}
}
function h(e) {
	let t = [];
	for (let n of e.sections) {
		t.push(n.blocks);
		for (let e of [n.header, n.footer]) e && t.push(e.blocks, e.firstPage ?? [], e.evenPage ?? []);
	}
	for (let n of e.footnotes ?? []) t.push(n.blocks);
	return t;
}
function g(e, n = e) {
	let r = /* @__PURE__ */ new Map();
	for (let t of h(e)) m(t, (e, t, n, i) => {
		r.has(e) || r.set(e, {
			id: e,
			kind: t,
			text: i,
			children: n
		});
	});
	let i = /* @__PURE__ */ new Set(), a = /* @__PURE__ */ new Map();
	for (let e of h(n)) m(e, (e, t, n, r, o) => {
		t === "hidden" || o || (i.add(e), r != null && !a.has(e) && a.set(e, r));
	});
	for (let e of r.values()) {
		if (e.text == null) continue;
		let n = a.get(e.id);
		n != null && (n === e.text ? e.shift = 0 : n.endsWith(e.text) && (e.shift = t(n) - t(e.text)));
	}
	return {
		nodes: r,
		rendered: i
	};
}
function _(e, t, n = 0) {
	if (e.rendered.has(t)) return [t];
	let r = e.nodes.get(t);
	return !r || n > 64 ? [] : r.children.flatMap((t) => _(e, t, n + 1));
}
function v(e, n) {
	let r = e.offsetUnit ?? "scalar";
	if (r !== "scalar" && r !== "utf16") return {
		ok: !1,
		status: "unsupported"
	};
	let i = [];
	for (let a of [e, ...e.segments ?? []]) {
		let e = n.nodes.get(a.node);
		if (!e) return {
			ok: !1,
			status: "missing"
		};
		if (a.start == null && a.end == null) {
			let t = _(n, e.id);
			if (!t.length) return {
				ok: !1,
				status: e.kind === "hidden" ? "unsupported" : "missing"
			};
			i.push({
				node: e.id,
				text: !1,
				targets: t
			});
			continue;
		}
		if (e.kind !== "text" || e.text == null || e.shift == null) return {
			ok: !1,
			status: "unsupported"
		};
		let o = e.text, s = r === "utf16" ? o.length : t(o), c = a.start ?? 0, l = a.end ?? s, d = u(o, c, r, "scalar"), f = u(o, l, r, "scalar");
		if (d == null || f == null || d > f) return {
			ok: !1,
			status: "missing"
		};
		i.push({
			node: e.id,
			text: !0,
			start: d + e.shift,
			end: f + e.shift
		});
	}
	return {
		ok: !0,
		ranges: i
	};
}
var y = 1, b = 3, x = (e, t) => e.nodeType === y ? e.getAttribute?.(t) ?? null : null;
function S(e, n = 0) {
	let r = [], i = n, a = (e, n, o) => {
		if (e.nodeType === b) {
			if (!o) return;
			let a = t(e.nodeValue ?? "");
			r.push({
				kind: "text",
				node: e,
				start: i,
				end: i + a,
				path: n
			}), i += a;
			return;
		}
		if (e.nodeType !== y) return;
		let s = x(e, "data-doc-atom");
		if (s != null) {
			let t = Number(s);
			Number.isInteger(t) && i <= t && (r.push({
				kind: "atom",
				node: e,
				start: t,
				end: t + 1,
				path: n
			}), i = t + 1);
			return;
		}
		let c = x(e, "data-doc-run");
		if (c != null) {
			let e = Number(c);
			Number.isInteger(e) && i < e && (i = e), o = !0;
		}
		for (let t = 0; t < e.childNodes.length; t++) a(e.childNodes[t], [...n, t], o);
	};
	return a(e, [], !1), {
		start: n,
		end: i,
		pieces: r
	};
}
var C = (e, t) => Array.prototype.indexOf.call(e.childNodes, t);
function w(e) {
	return e.kind === "text" ? {
		node: e.node,
		offset: 0
	} : {
		node: e.node.parentNode,
		offset: C(e.node.parentNode, e.node)
	};
}
function T(e) {
	return e.kind === "text" ? {
		node: e.node,
		offset: (e.node.nodeValue ?? "").length
	} : {
		node: e.node.parentNode,
		offset: C(e.node.parentNode, e.node) + 1
	};
}
function E(e, t) {
	return {
		node: e.node,
		offset: c(e.node.nodeValue ?? "", t - e.start) ?? 0
	};
}
function D(e, t, n) {
	let r = Math.max(t, e.start), i = Math.min(n, e.end);
	if (r > i || r === i && t !== n) return;
	let a = e.pieces.find((e) => e.end > r);
	if (r === i) {
		let t = a ? a.start >= r ? w(a) : E(a, r) : void 0, n = e.pieces[e.pieces.length - 1], i = t ?? (n ? T(n) : void 0);
		return i && {
			start: i,
			end: i
		};
	}
	let o;
	for (let t of e.pieces) t.start < i && (o = t);
	if (a && o) return {
		start: a.start >= r ? w(a) : E(a, r),
		end: o.end <= i ? T(o) : E(o, i)
	};
}
function O(e, t) {
	let n = [];
	for (let r = t; r !== e; r = r.parentNode) {
		if (!r?.parentNode) return;
		n.unshift(C(r.parentNode, r));
	}
	return n;
}
function k(e, t) {
	for (let n = 0; n < Math.min(e.length, t.length); n++) if (e[n] !== t[n]) return e[n] - t[n];
	return e.length - t.length;
}
var A = (e, t) => e.length <= t.length && e.every((e, n) => e === t[n]);
function j(e, t, n, r, i) {
	let a = O(t, n);
	if (!a) return;
	let o = n.nodeType === b ? a : [...a, r];
	for (let t of e.pieces) {
		if (t.node === n && t.kind === "text") return t.start + (l(n.nodeValue ?? "", Math.min(r, (n.nodeValue ?? "").length), i) ?? 0);
		if (t.kind === "atom" && t.path.length < o.length && A(t.path, o)) return i === "start" ? t.start : t.end;
		if (k(t.path, o) >= 0) return t.start;
	}
	return e.end;
}
var M = "[data-node-id],[data-row-id],[data-cell-id],[data-item-id]";
function N(e, t = []) {
	for (let n = 0; n < e.childNodes.length; n++) {
		let r = e.childNodes[n];
		r.nodeType === y && ((x(r, "data-node-id") != null || x(r, "data-row-id") != null || x(r, "data-cell-id") != null || x(r, "data-item-id") != null) && t.push(r), N(r, t));
	}
	return t;
}
var P = (e) => e == null || e === "" ? void 0 : Number(e), F = class {
	generation = 0;
	pages = [];
	notes = [];
	byNode = /* @__PURE__ */ new Map();
	byElement = /* @__PURE__ */ new WeakMap();
	maps = /* @__PURE__ */ new WeakMap();
	reset(e) {
		this.generation = e, this.pages = [], this.notes = [], this.byNode = /* @__PURE__ */ new Map(), this.byElement = /* @__PURE__ */ new WeakMap(), this.maps = /* @__PURE__ */ new WeakMap();
	}
	get pageCount() {
		return this.pages.length;
	}
	addPage(e, t) {
		let n = this.pages.length;
		this.pages.push(this.scan(e, n, t));
	}
	splice(e, t, n) {
		let r = this.pages.slice(e, e + t), i = this.pages.slice(e + t);
		for (let e of i[0] ?? []) e.kind === "text" && e.continuation && this.textMap(e);
		for (let e of [...r, ...i]) for (let t of e) {
			let e = this.byNode.get(t.node);
			if (!e) continue;
			let n = e.indexOf(t);
			n >= 0 && e.splice(n, 1), e.length || this.byNode.delete(t.node);
		}
		for (let e of r) for (let t of e) this.byElement.delete(t.element);
		this.pages.length = e;
		for (let { root: e, found: t } of n) this.addPage(e, t);
		for (let e of i) {
			let t = this.pages.length;
			for (let n of e) {
				n.page = t;
				let e = this.byNode.get(n.node) ?? [];
				n.instance = e.length, e.push(n), this.byNode.set(n.node, e);
			}
			this.pages.push(e);
		}
	}
	setNotes(e, t) {
		for (let e of this.notes) {
			let t = this.byNode.get(e.node);
			t && this.byNode.set(e.node, t.filter((t) => t !== e));
		}
		this.notes = e ? this.scan(e, -1, t) : [];
	}
	scan(e, t, n) {
		let r = [];
		for (let i of Array.from(n ?? N(e))) {
			let n = x(i, "data-node-id") ?? x(i, "data-row-id") ?? x(i, "data-cell-id") ?? x(i, "data-item-id");
			if (n == null) continue;
			let a = x(i, "data-node-id") == null ? x(i, "data-row-id") == null ? x(i, "data-cell-id") == null ? "item" : "cell" : "row" : x(i, "data-doc-text") == null ? "block" : "text", o = t < 0 ? "note" : "body", s, c;
			for (let t = i; t && t !== e; t = t.parentNode) x(t, "data-preview-repeated") == null ? o === "body" && /(^|\s)doc-running(\s|$)/.test(x(t, "class") ?? "") && (o = "running") : o = "repeat", t !== i && s == null && x(t, "data-node-id") != null && a !== "text" && a !== "block" && (s = x(t, "data-node-id") ?? void 0), c ??= P(x(t, "data-row-index"));
			let l = this.byNode.get(n) ?? [], u = l.filter((e) => e.role === o).length, d = {
				node: n,
				kind: a,
				element: i,
				page: t,
				generation: this.generation,
				role: o,
				instance: l.length,
				continuation: a === "text" ? x(i, "data-preview-continuation") === "true" : o === "body" && u > 0,
				table: a === "row" || a === "cell" ? {
					table: s,
					row: c ?? 0,
					...a === "cell" ? {
						col: P(x(i, "data-col-index")) ?? 0,
						rowSpan: P(x(i, "rowspan")) ?? 1,
						colSpan: P(x(i, "colspan")) ?? 1
					} : {}
				} : void 0
			};
			l.push(d), this.byNode.set(n, l), this.byElement.set(i, d), r.push(d);
		}
		return r;
	}
	isCurrent(e) {
		return e.generation === this.generation && this.byElement.get(e.element) === e;
	}
	fragments(e) {
		return this.byNode.get(e) ?? [];
	}
	pageFragments(e) {
		return e < 0 ? this.notes : this.pages[e] ?? [];
	}
	fragmentOf(e) {
		let t = this.byElement.get(e);
		return t && t.generation === this.generation ? t : void 0;
	}
	textMap(e) {
		let t = this.maps.get(e);
		if (t) return t;
		let n = 0;
		if (e.continuation) {
			let t = this.fragments(e.node), r = t.indexOf(e);
			for (let i = r - 1; i >= 0; i--) if (t[i].kind === "text" && t[i].role === e.role) {
				n = this.textMap(t[i]).end;
				break;
			}
		}
		return t = S(e.element, n), this.maps.set(e, t), t;
	}
	resolveText(e, t, n) {
		let r = [], i = this.fragments(e).filter((e) => e.kind === "text" && e.role !== "repeat");
		if (t === n) {
			let e;
			for (let r of i) {
				let i = this.textMap(r);
				if (i.start <= t && t < i.end) {
					e = {
						fragment: r,
						start: t,
						end: n
					};
					break;
				}
				t === i.end && (i.start < i.end || t === i.start) && (e ??= {
					fragment: r,
					start: t,
					end: n
				});
			}
			return {
				parts: e ? [e] : [],
				covered: !!e
			};
		}
		for (let e of i) {
			let i = this.textMap(e), a = Math.max(t, i.start), o = Math.min(n, i.end);
			a < o && r.push({
				fragment: e,
				start: a,
				end: o
			});
		}
		let a = t;
		for (let e of [...r].sort((e, t) => e.start - t.start)) {
			if (e.start > a) break;
			a = Math.max(a, e.end);
		}
		return {
			parts: r,
			covered: a >= n
		};
	}
	resolveBlock(e) {
		return e.flatMap((e) => this.fragments(e).filter((e) => e.role !== "repeat"));
	}
};
function I(e, t, n) {
	let r = [], i = [], a = !0;
	for (let n of t) if (n.text) {
		let t = e.resolveText(n.node, n.start, n.end);
		r.push(...t.parts), a &&= t.covered;
	} else {
		let t = e.resolveBlock(n.targets);
		i.push(...t), a &&= t.length > 0;
	}
	return {
		status: a ? "found" : n ? "missing" : "pending",
		text: r,
		blocks: i
	};
}
var L = [
	"mark",
	"comment",
	"insert",
	"delete",
	"format",
	"protected"
], R = class {
	groups = /* @__PURE__ */ new Map();
	set(e) {
		let t = /* @__PURE__ */ new Map();
		for (let n of e) {
			let e = String(n.group), r = String(n.id), i = L.includes(n.tone) ? n.tone : "mark", a = t.get(e) ?? /* @__PURE__ */ new Map();
			a.set(r, {
				key: `${e}\u0000${r}`,
				id: r,
				group: e,
				tone: i,
				anchor: n.anchor
			}), t.set(e, a);
		}
		let n = [];
		for (let e of t.keys()) n.push(...this.groups.get(e)?.values() ?? []);
		for (let [e, n] of t) this.groups.set(e, n);
		return {
			added: [...t.values()].flatMap((e) => [...e.values()]),
			removed: n
		};
	}
	clear(e) {
		if (e == null) {
			let e = this.entries();
			return this.groups.clear(), e;
		}
		let t = [...this.groups.get(e)?.values() ?? []];
		return this.groups.delete(e), t;
	}
	entries() {
		return [...this.groups.values()].flatMap((e) => [...e.values()]);
	}
	has(e) {
		return this.groups.get(e.group)?.get(e.id) === e;
	}
};
function z(e, n, r) {
	let i = e.some((e) => e.role === "body" || e.role === "note"), a = /* @__PURE__ */ new Map();
	for (let r of e) {
		if (i && (r.role === "running" || r.role === "repeat")) continue;
		let e = n.nodes.get(r.node);
		if (e?.kind !== "text" || e.text == null || e.shift == null) continue;
		let o = t(e.text), s = Math.min(o, Math.max(0, r.start - e.shift)), c = Math.min(o, Math.max(0, r.end - e.shift)), l = a.get(r.node);
		a.set(r.node, l ? {
			start: Math.min(l.start, s),
			end: Math.max(l.end, c)
		} : {
			start: s,
			end: c
		});
	}
	let o = [];
	for (let [e, t] of a) {
		if (t.end <= t.start) continue;
		let i = n.nodes.get(e).text, a = d(i, t.start, t.end);
		o.push(r === "utf16" ? {
			node: e,
			start: c(i, t.start),
			end: c(i, t.end),
			text: a
		} : {
			node: e,
			start: t.start,
			end: t.end,
			text: a
		});
	}
	return o.length ? {
		offsetUnit: r,
		text: o.map((e) => e.text).join("\n"),
		segments: o
	} : null;
}
function B() {
	return typeof CSS < "u" && "highlights" in CSS && typeof Highlight == "function" ? CSS.highlights : void 0;
}
function V() {
	return !!B();
}
function H(e) {
	let t = B();
	if (!t) return;
	let n = `mo-doc-${e}`, r = t.get(n);
	return r || (r = new Highlight(), r.priority = e === "current" ? 2 : +(e === "format"), t.set(n, r)), r;
}
var U = class {
	ranges = /* @__PURE__ */ new Map();
	elements = /* @__PURE__ */ new Map();
	tones = /* @__PURE__ */ new Map();
	addRange(e, t, n) {
		let r = H(t);
		if (!r) return !1;
		r.add(n);
		let i = this.ranges.get(e) ?? [];
		return i.push({
			tone: t,
			range: n
		}), this.ranges.set(e, i), !0;
	}
	addElement(e, t, n) {
		let r = this.elements.get(e) ?? [];
		r.push(n), this.elements.set(e, r);
		let i = this.tones.get(n) ?? [];
		i.push({
			key: e,
			tone: t
		}), this.tones.set(n, i), this.apply(n);
	}
	apply(e) {
		let t = this.tones.get(e);
		t?.length ? e.setAttribute("data-doc-highlight", t[t.length - 1].tone) : (e.removeAttribute("data-doc-highlight"), this.tones.delete(e));
	}
	remove(e) {
		for (let { tone: t, range: n } of this.ranges.get(e) ?? []) H(t)?.delete(n);
		this.ranges.delete(e);
		for (let t of this.elements.get(e) ?? []) {
			let n = this.tones.get(t);
			n && this.tones.set(t, n.filter((t) => t.key !== e)), this.apply(t);
		}
		this.elements.delete(e);
	}
	clear() {
		for (let e of [...this.ranges.keys(), ...this.elements.keys()]) this.remove(e);
	}
};
export { M as FRAGMENT_SELECTOR, F as FragmentIndex, U as HighlightPainter, R as HighlightStore, e as OBJECT_UNIT, V as canHighlightText, u as convertOffset, D as domRange, g as indexModel, r as inlineLength, a as inlineOffsets, n as inlineText, p as isLabelledList, S as mapText, v as normalizeAnchor, j as offsetAt, i as paragraphText, _ as renderTargets, I as resolveRanges, t as scalarLength, c as scalarToUtf16, z as selectionFromParts, d as sliceScalar, f as tableGrid, l as utf16ToScalar };
