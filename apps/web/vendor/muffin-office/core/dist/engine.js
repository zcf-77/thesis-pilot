// packages/core/src/document-selection.ts
function e(e, t) {
	let n, r = Infinity;
	for (let i of e) {
		let e = t(i);
		e < r && (n = i, r = e);
	}
	return n;
}
function t(e, t, n) {
	return Math.max(t - e, e - n, 0);
}
function n(e, t) {
	return Math.abs(e.y - t.y) <= Math.min(e.h, t.h) / 2;
}
function r(e, t) {
	if (!Number.isInteger(t) || t < 0 || t > e.length) return !1;
	let n = e.charCodeAt(t - 1), r = e.charCodeAt(t);
	return !(n >= 55296 && n <= 56319 && r >= 56320 && r <= 57343);
}
function i(e, t, n, i) {
	if (![
		e.x,
		e.y,
		e.w,
		e.h
	].every(Number.isFinite) || e.w < 0 || e.h <= 0) throw RangeError("Invalid Office line geometry");
	if (!r(i.text, n.start) || !r(i.text, n.end) || n.start > n.end) throw RangeError("Invalid Office line source span");
	if (!t.length && n.start !== n.end) throw RangeError("Office text line has no caret stops");
	let a = n.start, o = t[0]?.x ?? e.x, s = Math.sign((t.at(-1)?.x ?? o) - o);
	for (let e of t) {
		if (!r(i.text, e.offset) || e.offset < a || e.offset > n.end || !Number.isFinite(e.x)) throw RangeError("Invalid Office caret stop");
		if (Math.abs(e.x - o) > 1e-7 && Math.sign(e.x - o) !== s) throw RangeError("Mixed-direction Office caret geometry is unsupported");
		a = e.offset, o = e.x;
	}
}
var a = class {
	lines = [];
	byPage = /* @__PURE__ */ new Map();
	bySource = /* @__PURE__ */ new Map();
	sources;
	constructor(e, t) {
		this.sources = e.sources;
		for (let n of e.pages) {
			if (!Number.isInteger(n.pageIndex) || n.pageIndex < 0 || this.byPage.has(n.pageIndex)) throw RangeError("Invalid or duplicate Office page index");
			let r = [];
			for (let a of n.fragments) if (!a.repeated) for (let o of a.lines) {
				let s = o.span ?? a.span;
				if (!s) continue;
				let c = Object.hasOwn(e.sources, s.sourceId) ? e.sources[s.sourceId] : void 0;
				if (!c || typeof c.text != "string") throw RangeError("Office span source is missing");
				if (!t(c, n.region)) continue;
				i(o.rect, o.caretStops, s, c);
				let l = this.bySource.get(s.sourceId);
				l || (l = {
					order: this.bySource.size,
					lines: [],
					after: /* @__PURE__ */ new Map()
				}, this.bySource.set(s.sourceId, l));
				let u = o.caretStops.length ? o.caretStops : [{
					offset: s.start,
					x: o.rect.x
				}], d = l.lines.at(-1)?.raw, f = !!d && d.length > 1 && d.at(-1).offset === d.at(-2).offset && d.at(-1).offset === u[0].offset, p = {
					index: this.lines.length,
					sourceId: s.sourceId,
					pageIndex: n.pageIndex,
					fragmentId: a.id,
					rect: o.rect,
					raw: u,
					stops: u.filter((e, t) => t ? e.offset !== u[t - 1].offset : !f)
				};
				this.lines.push(p), p.stops.length && r.push(p), l.lines.push(p);
			}
			this.byPage.set(n.pageIndex, r);
		}
		for (let e of this.bySource.values()) {
			let t = /* @__PURE__ */ new Set();
			for (let n of e.lines) for (let e of n.raw) t.add(e.offset);
			let n = [...t].sort((e, t) => e - t);
			for (let t = 0; t + 1 < n.length; t++) e.after.set(n[t], n[t + 1]);
		}
	}
	point(t, n) {
		let r = e(t.stops, (e) => Math.abs(e.x - n));
		return {
			sourceId: t.sourceId,
			offset: r.offset,
			line: t.index
		};
	}
	line(e) {
		let t = e.line === void 0 ? void 0 : this.lines[e.line];
		if (t?.sourceId === e.sourceId && t.stops.some((t) => t.offset === e.offset)) return t;
		let n = this.bySource.get(e.sourceId)?.lines;
		for (let t = (n?.length ?? 0) - 1; t >= 0; t--) {
			let r = n[t];
			if (r.stops.some((t) => t.offset === e.offset)) return r;
		}
	}
	hit(n, r, i, a) {
		let o = this.byPage.get(n);
		if (!o?.length || !Number.isFinite(r) || !Number.isFinite(i)) return null;
		let s = e(a ? o.filter((e) => e.fragmentId === a) : o, (e) => {
			let n = t(r, e.rect.x, e.rect.x + e.rect.w), a = t(i, e.rect.y, e.rect.y + e.rect.h);
			return n * n + a * a;
		});
		return s ? this.point(s, r) : null;
	}
	bounds(e) {
		let t = this.bySource.get(e.anchor.sourceId), n = this.bySource.get(e.focus.sourceId);
		return !t || !n || !r(this.sources[e.anchor.sourceId].text, e.anchor.offset) || !r(this.sources[e.focus.sourceId].text, e.focus.offset) || !this.line(e.anchor) || !this.line(e.focus) ? null : t.order < n.order || t.order === n.order && e.anchor.offset <= e.focus.offset ? [e.anchor, e.focus] : [e.focus, e.anchor];
	}
	caret(e) {
		let t = this.line(e), n = t?.stops.find((t) => t.offset === e.offset);
		return t && n ? {
			pageIndex: t.pageIndex,
			x: n.x,
			y: t.rect.y,
			w: 0,
			h: t.rect.h
		} : null;
	}
	rectangles(e) {
		let t = this.bounds(e);
		if (!t) return [];
		let [n, r] = t, i = this.bySource.get(n.sourceId).order, a = this.bySource.get(r.sourceId).order, o = [];
		for (let [e, t] of this.bySource) {
			if (t.order < i) continue;
			if (t.order > a) break;
			let s = e === n.sourceId ? n.offset : 0, c = e === r.sourceId ? r.offset : this.sources[e].text.length;
			if (!(s >= c)) for (let e of t.lines) {
				let n = Infinity, r = -Infinity;
				for (let i = 0; i + 1 < e.raw.length; i++) {
					let a = e.raw[i], o = e.raw[i + 1], l = o.offset > a.offset ? o.offset : t.after.get(a.offset);
					l === void 0 || a.offset < s || l > c || (n = Math.min(n, a.x, o.x), r = Math.max(r, a.x, o.x));
				}
				r > n && o.push({
					pageIndex: e.pageIndex,
					x: n,
					y: e.rect.y,
					w: r - n,
					h: e.rect.h
				});
			}
		}
		return o;
	}
	text(e, t = "\n") {
		let n = this.bounds(e);
		if (!n) return "";
		let [r, i] = n, a = this.bySource.get(r.sourceId).order, o = this.bySource.get(i.sourceId).order, s = [];
		for (let [e, t] of this.bySource) if (!(t.order < a)) {
			if (t.order > o) break;
			s.push(this.sources[e].text.slice(e === r.sourceId ? r.offset : 0, e === i.sourceId ? i.offset : void 0));
		}
		return s.join(t);
	}
	lineEdge(e, t) {
		let n = this.line(e), r = t === "start" ? n?.stops[0] : n?.stops.at(-1);
		return n && r ? {
			sourceId: n.sourceId,
			offset: r.offset,
			line: n.index
		} : null;
	}
	vertical(r, i, a) {
		let o = this.line(r);
		if (!o || !Number.isFinite(a)) return null;
		let s = this.byPage.get(o.pageIndex), c = (e) => (e.rect.y - o.rect.y) * i, l = e(s, (e) => c(e) > 0 && !n(o.rect, e.rect) ? c(e) : Infinity), u = (l ? void 0 : e([...this.byPage.entries()], ([e, t]) => {
			let n = (e - o.pageIndex) * i;
			return n > 0 && t.length ? n : Infinity;
		}))?.[1], d = l ?? (u && e(u, (e) => e.rect.y * i));
		if (!d) return null;
		let f = e(l ? s : u, (e) => n(e.rect, d.rect) && (!l || !n(e.rect, o.rect)) ? t(a, e.rect.x, e.rect.x + e.rect.w) : Infinity);
		return f ? this.point(f, a) : null;
	}
}, o = 12e4, s = 2e4, c = class {
	onFatal;
	options;
	worker;
	seq = 0;
	pending = /* @__PURE__ */ new Map();
	constructor(e, t = {}) {
		this.onFatal = e, this.options = t;
	}
	ensure() {
		if (this.worker) return this.worker;
		let e = new Worker(new URL("./office.worker.js",import.meta.url), { type: "module" });
		return this.options.assetBase != null && e.postMessage({
			op: "configure",
			assetBase: new URL(String(this.options.assetBase), globalThis.location?.href).href
		}), e.onmessage = (e) => {
			let t = e.data, n = this.pending.get(t.id);
			n && ("stage" in t ? (clearTimeout(n.timer), n.timer = this.timeout(n.op, "compute")) : (this.pending.delete(t.id), clearTimeout(n.timer), t.ok ? n.resolve(t.data) : n.reject(Error(t.error))));
		}, e.onerror = (e) => {
			e.preventDefault(), this.fail(`Worker 错误：${e.message || "脚本加载失败"}`);
		}, e.onmessageerror = () => this.fail("Worker 消息无法反序列化"), this.worker = e, e;
	}
	fail(e) {
		this.worker?.terminate(), this.worker = void 0;
		let t = [...this.pending.values()];
		this.pending.clear();
		for (let n of t) clearTimeout(n.timer), n.reject(Error(e));
		this.onFatal(e);
	}
	timeout(e, t) {
		return t === "load" ? setTimeout(() => this.fail(`超时：${e} 的引擎模块 ${o / 1e3} s 内没有下载完（网络过慢），Worker 已重建，请重试`), o) : setTimeout(() => this.fail(`超时：${e} 计算超过 ${s / 1e3} s，Worker 已重建`), s);
	}
	call(e, t = []) {
		let n = this.ensure(), r = ++this.seq;
		return new Promise((i, a) => {
			let o = this.timeout(e.op, "load");
			this.pending.set(r, {
				resolve: i,
				reject: a,
				timer: o,
				op: e.op
			}), n.postMessage({
				...e,
				id: r
			}, t);
		});
	}
	init() {
		return this.call({ op: "init" });
	}
	openModel(e) {
		return this.call({
			op: "open-model",
			modelJson: e
		});
	}
	importOffice(e, t, n = !1) {
		return this.call({
			op: "import-office",
			bytes: e,
			format: t,
			strict: n
		}, [e]);
	}
	layoutDocs(e, t) {
		return this.call({
			op: "layout-docs",
			modelJson: e,
			opts: t
		});
	}
	convert(e, t) {
		return this.call({
			op: "convert",
			md: e,
			opts: t
		});
	}
	transact(e, t) {
		return this.call({
			op: "transact",
			modelJson: e,
			transaction: JSON.parse(JSON.stringify(t))
		});
	}
	exportFile(e, t, n) {
		return this.call({
			op: "export",
			modelJson: e,
			format: t,
			theme: n
		});
	}
	dispose() {
		this.worker?.terminate(), this.worker = void 0;
		for (let e of this.pending.values()) clearTimeout(e.timer), e.reject(/* @__PURE__ */ Error("Engine client disposed"));
		this.pending.clear();
	}
};
export { a as DocumentSelection, c as EngineClient };
