# MuffinOffice 使用授权说明

MuffinOffice（muffin-office）是本仓库所有者的专有软件，著作权归其所有，不开源。

本目录只包含为 ThesisPilot 构建的产物：`@muffin-office/core` 与 `@muffin-office/vue` 的编译输出（ES 模块与类型声明）、office-wasm 的 WebAssembly 模块、文档操作一致性金标与模型 JSON Schema。不含 TypeScript/Rust 源码、服务端程序、容器镜像与服务端许可文件。

授权范围：仅用于 ThesisPilot 的开发、演示与赛事评审。不得再分发、再许可、出售或单独使用本目录中的任何文件，不得据此制作衍生作品或对外提供服务。获得 ThesisPilot 仓库访问权限不等于获得 MuffinOffice 的任何其他权利。

第三方组件按其各自许可证提供；office-wasm 的 Rust 依赖清单见 `THIRD-PARTY-RUST.txt`。

来源：muffin-office-poc origin/main 的归档快照（archive 解出，无版本库元数据）（提交 cfb8352）。构建方式与逐文件哈希见 `VENDOR.json`，可用 `node scripts/vendor-muffin-office.mjs --from <来源> --rev <提交> --verify` 复核。
