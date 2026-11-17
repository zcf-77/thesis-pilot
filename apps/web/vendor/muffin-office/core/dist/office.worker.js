// packages/core/src/wasm-loader.ts
async function e(e, t) {
	let n = new AbortController();
	performance.now();
	try {
		let [r, i] = await Promise.all([e().then((e) => e), fetch(t, { signal: n.signal }).then((e) => e)]);
		if (!i.ok) throw Error(`WASM HTTP ${i.status}`);
		performance.now();
		let a = await i.arrayBuffer();
		return performance.now(), await r.default({ module_or_path: a }), {
			wasm: r,
			bytes: a.byteLength
		};
	} catch (e) {
		throw n.abort(), e;
	}
}
// packages/core/src/office.worker.ts
var t = {
	docs: "gongwen",
	slides: "business-blue"
};
function n(e, t) {
	return t();
}
var r = self.location.origin + "/", i;
function a() {
	let t = r;
	return i ??= e(() => import(
		/* @vite-ignore */
		`${t}pkg/office_wasm.js`
), `${t}pkg/office_wasm_bg.wasm`), i.catch(() => {
		i = void 0;
	}), i;
}
var o;
function s() {
	let t = r + "pkg-import/";
	return o ??= e(() => import(
		/* @vite-ignore */
		`${t}office_import_wasm.js`
), t + "office_import_wasm_bg.wasm"), o.catch(() => {
		o = void 0;
	}), o;
}
var c;
function l() {
	let t = r + "pkg-layout/";
	return c ??= e(() => import(
		/* @vite-ignore */
		`${t}office_layout_wasm.js`
), t + "office_layout_wasm_bg.wasm"), c.catch(() => {
		c = void 0;
	}), c;
}
async function u(e, t, i) {
	let { wasm: a, bytes: o } = await l(), s = performance.now(), c = JSON.parse(a.required_faces(e)), u = 0;
	return await Promise.all(c.map(async (e) => {
		let t = await fetch(`${r}pkg-layout/metrics/${e}.bin`);
		if (!t.ok) throw Error(`metrics ${e}: HTTP ${t.status}`);
		let n = new Uint8Array(await t.arrayBuffer());
		u += n.byteLength, a.add_metrics(e, n);
	})), i(), {
		layout: JSON.parse(n("layout-docs", () => a.layout_docs(e, JSON.stringify(t ?? {})))),
		layoutWasmBytes: o,
		metricsBytes: u,
		metricsLoaded: c,
		engineMs: performance.now() - s
	};
}
var d, f = !1;
function p(e) {
	if (f) return;
	let t = JSON.parse(e.plan_to_model(JSON.stringify({
		schemaVersion: 1,
		title: "Engine initialization",
		theme: "business-blue",
		slides: [{
			layout: "title",
			title: "Initialize"
		}]
	}), "{}"));
	e.txn(JSON.stringify(t.model), JSON.stringify({
		txn: [{
			op: "slides.set_slot",
			id: t.model.slides[0].id,
			slot: {
				kind: "title",
				content: {
					type: "text",
					inlines: [{
						type: "run",
						text: "Ready"
					}]
				}
			}
		}],
		mode: "apply",
		actor: "system:initialize"
	})), f = !0;
}
function m(e) {
	return d ??= JSON.parse(e.builtin_themes()), d;
}
function h(e, r, i) {
	let a = {};
	i.kind && (a.kind = i.kind), i.theme && (a.theme = i.theme);
	let o = i.inputFormat === "slide-plan", s = o ? JSON.parse(n("parse-plan", () => e.plan_to_model(r, JSON.stringify(i.theme ? { theme: i.theme } : {})))) : null, c = s ? JSON.stringify(s.model) : n("parse-markdown", () => e.md_to_model(r, JSON.stringify(a))), l = JSON.parse(c), u = s?.warnings ?? [], d = m(e).find((e) => e.name === l.theme.name);
	if (!o && d && d.kind !== l.kind) {
		let n = t[l.kind];
		u.push(`${i.theme ? "所选主题" : "frontmatter 主题"} ${d.name} 属于 ${d.kind}，与模型类别 ${l.kind} 不符，已改用 ${n}`), c = e.md_to_model(r, JSON.stringify({
			...a,
			theme: n
		})), l = JSON.parse(c);
	}
	return g(e, c, u);
}
function g(e, t, r, i = !0) {
	let a = t, o = JSON.parse(a), s;
	if (o.kind === "slides" && i) {
		let t = JSON.parse(n("paginate-slides", () => e.paginate_model(a, "{}")));
		o = t.model, a = JSON.stringify(o), s = t.pages, s.length > t.sourceSlides && r.push(`已自动拆页：${t.sourceSlides} 页 → ${s.length} 页；续页保留内容、接续编号并重复表头。`);
	}
	let c = n("emit-markdown", () => e.model_to_markdown(a));
	if (o.kind === "slides") {
		let t = JSON.parse(n("layout-slides", () => e.layout_deck(a, null))), i = JSON.parse(n("pptx-diagnostics", () => e.model_to_pptx_diagnostics(a, null)));
		return {
			model: o,
			modelJson: a,
			markdown: c,
			layout: t,
			pagination: s,
			report: {
				format: "pptx",
				data: i
			},
			warnings: r,
			engineMs: 0
		};
	}
	let l = JSON.parse(e.model_to_docx_report(a, null)), u = JSON.parse(e.docs_preview_context(a));
	return {
		model: o,
		modelJson: a,
		markdown: c,
		docsPreview: u,
		report: {
			format: "docx",
			data: l
		},
		warnings: r,
		engineMs: 0
	};
}
function _(e, t = []) {
	self.postMessage(e, t);
}
self.onmessage = async (e) => {
	let t = e.data;
	if (t.op === "configure") {
		r = t.assetBase.endsWith("/") ? t.assetBase : t.assetBase + "/";
		return;
	}
	let i = t;
	try {
		if (i.op === "layout-docs") {
			_({
				id: i.id,
				ok: !0,
				op: "layout-docs",
				data: await u(i.modelJson, i.opts, () => _({
					id: i.id,
					stage: "compute"
				}))
			});
			return;
		}
		let { wasm: e, bytes: t } = await a();
		i.op === "import-office" && await s(), _({
			id: i.id,
			stage: "compute"
		});
		let r = performance.now();
		switch (i.op) {
			case "init": {
				n("transaction-initialization", () => p(e));
				let a = {
					version: e.engine_version(),
					wasmBytes: t,
					themes: n("theme-initialization", () => m(e)),
					engineMs: 0
				};
				a.engineMs = performance.now() - r, _({
					id: i.id,
					ok: !0,
					op: "init",
					data: a
				});
				break;
			}
			case "convert": {
				let t = h(e, i.md, i.opts);
				t.engineMs = performance.now() - r, _({
					id: i.id,
					ok: !0,
					op: "convert",
					data: t
				});
				break;
			}
			case "open-model": {
				let t = JSON.parse(n("validate-project", () => e.validate_project_model(i.modelJson))), a = g(e, JSON.stringify(t.model), t.warnings, !1);
				a.engineMs = performance.now() - r, _({
					id: i.id,
					ok: !0,
					op: "open-model",
					data: a
				});
				break;
			}
			case "import-office": {
				let t = await s(), a = JSON.parse(n("import-office", () => t.wasm.import_office(new Uint8Array(i.bytes), i.format, i.strict))), o = g(e, JSON.stringify(a.model), [], !1);
				o.importReport = {
					sourceFormat: a.sourceFormat,
					frontMatter: a.frontMatter,
					externalRelationships: a.externalRelationships,
					preserved: a.preserved,
					converted: a.converted,
					unsupported: a.unsupported
				}, o.importWasmBytes = t.bytes, o.engineMs = performance.now() - r, _({
					id: i.id,
					ok: !0,
					op: "import-office",
					data: o
				});
				break;
			}
			case "export": {
				let t = i.theme || null, n = (i.format === "docx" ? e.model_to_docx(i.modelJson, t) : e.model_to_pptx(i.modelJson, t)).slice().buffer, a = {
					bytes: n,
					format: i.format,
					engineMs: performance.now() - r
				};
				_({
					id: i.id,
					ok: !0,
					op: "export",
					data: a
				}, [n]);
				break;
			}
			case "transact": {
				let t = JSON.parse(e.txn(i.modelJson, JSON.stringify(i.transaction))), n = g(e, JSON.stringify(t.model), []);
				n.engineMs = performance.now() - r, _({
					id: i.id,
					ok: !0,
					op: "transact",
					data: {
						document: n,
						transaction: t.result
					}
				});
				break;
			}
		}
	} catch (e) {
		_({
			id: i.id,
			ok: !1,
			error: e instanceof Error ? e.message : String(e)
		});
	}
};
