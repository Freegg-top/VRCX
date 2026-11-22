<script>
    const localPathPromises = new Map();
    const pendingImageLoads = [];
    const maxConcurrentImageLoads = 8;
    let activeImageLoads = 0;

    function acquireImageLoad() {
        if (activeImageLoads < maxConcurrentImageLoads) {
            activeImageLoads++;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            pendingImageLoads.push(resolve);
        });
    }

    function releaseImageLoad() {
        const nextImageLoad = pendingImageLoads.shift();
        if (nextImageLoad) {
            nextImageLoad();
        } else {
            activeImageLoads--;
        }
    }

    async function loadLocalPath(url, fileId, version) {
        await acquireImageLoad();
        try {
            const path = await window.AppApi.GetImage(url, fileId, version);
            return path ? `file:///${path}` : '';
        } catch {
            return '';
        } finally {
            releaseImageLoad();
        }
    }
</script>

<script setup>
    import { ref, useAttrs, watch } from 'vue';

    defineOptions({ inheritAttrs: false });

    const props = defineProps({
        url: { type: String, default: '' }
    });

    const attrs = useAttrs();
    const src = ref(props.url);
    const failed = ref(false);

    watch(
        () => props.url,
        async (url) => {
            src.value = url;
            failed.value = false;

            const segments = url.split('/');
            const imageSegmentIndex = segments.indexOf('image');
            const fileId = segments[imageSegmentIndex + 1];
            const version = segments[imageSegmentIndex + 2];
            if (imageSegmentIndex === -1 || !fileId || !version || !window.AppApi?.GetImage) {
                return;
            }

            let localPathPromise = localPathPromises.get(url);
            if (!localPathPromise) {
                localPathPromise = loadLocalPath(url, fileId, version);
                localPathPromises.set(url, localPathPromise);
            }
            const localPath = await localPathPromise;
            if (localPath && props.url === url) {
                src.value = localPath;
            }
        },
        { immediate: true }
    );
</script>

<template>
    <img v-if="src && !failed" :src="src" loading="lazy" v-bind="attrs" @error="failed = true" />
    <slot v-else name="fallback" />
</template>
