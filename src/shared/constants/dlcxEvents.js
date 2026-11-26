const DLCX_REPLAY_ONBOARDING_EVENT = 'dlcx:replay-onboarding';

function dispatchDlcxEvent(name) {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(name));
    }
}

function replayDlcxOnboarding() {
    dispatchDlcxEvent(DLCX_REPLAY_ONBOARDING_EVENT);
}

export { DLCX_REPLAY_ONBOARDING_EVENT, replayDlcxOnboarding };
