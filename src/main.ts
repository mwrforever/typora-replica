// 应用入口：引入设计令牌与 Crepe 主题覆盖层，挂载根组件
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/tokens.css";
import "./styles/crepe-overrides.css";

createApp(App).use(createPinia()).mount("#app");
