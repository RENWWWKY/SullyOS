/**
 * 主代理 Worker 地址 —— 中心配置（单一可信源）
 *
 * SullyOS 一票联网能力都通过同一个 Cloudflare Worker 代理转发，源码全在
 * `worker/index.js`（单文件，可一键搬到自己的 Cloudflare 账号）。涉及：
 *   - 联网搜索 / 实时新闻热榜（Brave）       → /search /news
 *   - WebDAV 云备份代理                       → /webdav
 *   - GitHub 云备份代理（GFW 下走代理）       → /github
 *   - Notion 集成                             → /notion/*
 *   - 飞书多维表格集成                        → /feishu/*
 *   - 麦当劳 / 瑞幸 点单 MCP                   → /mcp/mcd /mcp/luckin
 *
 * 默认指向作者部署的公共实例。如果作者哪天不再维护、或你想完全自托管，
 * 把自己部署的 worker 地址填进「设置 → 网络代理 (Worker)」即可，
 * 以上全部能力会自动切到你的实例，无需改任何代码。
 *
 * 注意：网易云音乐（MusicContext）和小红书 Lite 各自在自己的 App / 设置里有
 * 独立的 worker 地址输入框，走各自的持久化，不受这里影响。
 */

export const DEFAULT_PROXY_WORKER = 'https://sullymeow.ccwu.cc';

const LS_KEY = 'sully_proxy_worker_url_v1';

// 旧的 *.workers.dev 默认域名 → 自定义域名。老用户 localStorage 里如果还存着
// 这个，读出来时自动当成"用的是默认"，回落到 DEFAULT_PROXY_WORKER（与
// MusicContext 的迁移逻辑一致：自定义域名走 CF 边缘到同一个 worker，行为相同）。
const STALE_HOSTS = [/sully-n\.qegj567\.workers\.dev/i];

const normalize = (url: string): string => url.trim().replace(/\/+$/, '');

/**
 * 读取当前生效的主代理 worker 地址（已去尾斜杠）。懒读 localStorage，
 * 用户在设置里改完、新发起的请求立刻生效，无需刷新页面。
 */
export const getProxyWorkerUrl = (): string => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PROXY_WORKER;
    const url = normalize(raw);
    if (!/^https?:\/\//i.test(url)) return DEFAULT_PROXY_WORKER;
    if (STALE_HOSTS.some((re) => re.test(url))) return DEFAULT_PROXY_WORKER;
    return url;
  } catch {
    return DEFAULT_PROXY_WORKER;
  }
};

/**
 * 写入自定义 worker 地址。传空、或传的就是默认地址 → 清掉本地存储（回到默认）。
 * 非法地址（不以 http(s):// 开头）直接忽略，由调用方负责校验提示。
 */
export const setProxyWorkerUrl = (url: string): void => {
  try {
    const trimmed = normalize(url || '');
    if (!trimmed || trimmed === DEFAULT_PROXY_WORKER) {
      localStorage.removeItem(LS_KEY);
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) return;
    localStorage.setItem(LS_KEY, trimmed);
  } catch {
    /* localStorage 不可用就当默认处理 */
  }
};

/** 当前是否在用自定义（非默认）worker。用于设置页提示文案。 */
export const isCustomProxyWorker = (): boolean => getProxyWorkerUrl() !== DEFAULT_PROXY_WORKER;
