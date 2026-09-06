// 应用入口：引入设计令牌与 Crepe 主题覆盖层，挂载根组件
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/tokens.css";
import "./styles/crepe-overrides.css";
// Typora 变量映射兜底层：crepe-overrides（基础层）之后、主题 link 之前——
// 兜底值优先级最低，主题层自定义的 --crepe-* 在更晚层取胜
import "./styles/typora-var-bridge.css";

createApp(App).use(createPinia()).mount("#app");
