// Crepe 工厂自验证：覆盖 onUpload 注入分支（07 图片模块的配置入口）
import { describe, expect, it } from "vitest";
import { createMarkwellEditor } from "./create-editor";

describe("createMarkwellEditor 工厂", () => {
  it("onUpload 回调注入 ImageBlock 特性配置（构造不抛错）", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onUpload = async (file: File) => `mock:${file.name}`;
    const crepe = createMarkwellEditor(root, "# 工厂", { onUpload });
    expect(crepe).toBeDefined();
    // 未 create 的实例直接 destroy 收尾，不遗留异步状态
    await crepe.destroy();
  });
});
