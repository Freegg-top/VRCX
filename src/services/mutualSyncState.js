import { reactive } from 'vue';

// 共同好友后台同步(mutualSyncCoordinator)与手动全图抓取(charts)的共享互斥标志。
// 放在独立模块, 避免协调器与 charts store 相互 import 造成循环依赖。
const mutualSyncState = reactive({
    isRunning: false
});

export { mutualSyncState };
