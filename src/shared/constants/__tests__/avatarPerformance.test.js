import {
    BYTES_PER_MIB,
    PERFORMANCE_RANKS,
    assessAgainstLimits,
    assessBounds,
    assessStat,
    collectStatEntries,
    isAnalysisUsable,
    isScoredMetric,
    pickTextureBytes,
    platformFamily
} from '../avatarPerformance.js';

describe('platformFamily', () => {
    test('only standalonewindows is treated as pc', () => {
        expect(platformFamily('standalonewindows')).toBe('pc');
        expect(platformFamily('android')).toBe('mobile');
        expect(platformFamily('ios')).toBe('mobile');
    });
});

describe('assessAgainstLimits', () => {
    test('a value exactly on the Excellent cap stays Excellent', () => {
        expect(assessAgainstLimits(32000, [32000, 70000, 70000, 70000]).rank).toBe('Excellent');
    });

    test('one over the Excellent cap falls to the next rank that still fits', () => {
        expect(assessAgainstLimits(32001, [32000, 70000, 70000, 70000]).rank).toBe('Good');
    });

    test('a value over the Poor cap is VeryPoor', () => {
        const assessed = assessAgainstLimits(80000, [32000, 70000, 70000, 70000]);
        expect(assessed.rank).toBe('VeryPoor');
        expect(assessed.maximum).toBe(70000);
        expect(assessed.ratio).toBeGreaterThan(1);
    });

    test('a must-not-exist metric is Excellent at zero and Poor at one', () => {
        expect(assessAgainstLimits(0, [0, 0, 0, 1]).rank).toBe('Excellent');
        expect(assessAgainstLimits(1, [0, 0, 0, 1]).rank).toBe('Poor');
    });

    test('a forbidden metric above a zero ceiling has an infinite ratio instead of a fake fill', () => {
        expect(assessAgainstLimits(1, [0, 0, 0, 0]).ratio).toBe(Infinity);
        expect(assessAgainstLimits(0, [0, 0, 0, 0]).ratio).toBe(0);
    });

    test('non-numeric values and missing limit rows are not assessed', () => {
        expect(assessAgainstLimits('a lot', [1, 2, 3, 4])).toBeNull();
        expect(assessAgainstLimits(1, undefined)).toBeNull();
    });
});

describe('assessStat', () => {
    test('texture usage converts bytes to MiB before comparing', () => {
        const excellent = assessStat('totalTextureUsage', 30 * BYTES_PER_MIB, 'standalonewindows');
        expect(excellent.rank).toBe('Excellent');
        const over = assessStat('totalTextureUsage', 200 * BYTES_PER_MIB, 'standalonewindows');
        expect(over.rank).toBe('VeryPoor');
    });

    test('boolean metrics are scored as 0/1', () => {
        expect(assessStat('particleTrailsEnabled', true, 'standalonewindows').rank).toBe('Medium');
        expect(assessStat('particleTrailsEnabled', false, 'standalonewindows').rank).toBe('Excellent');
    });

    test('metrics VRChat dropped from mobile scoring are reported as unscored, not Excellent', () => {
        expect(isScoredMetric('lightCount', 'mobile')).toBe(false);
        const assessed = assessStat('lightCount', 3, 'android');
        expect(assessed.scored).toBe(false);
        expect(assessed.rank).toBeNull();
        expect(assessed.value).toBe(3);
    });

    test('an unknown key is not assessed', () => {
        const assessed = assessStat('someNewStat', 5, 'standalonewindows');
        expect(assessed.rank).toBeNull();
        expect(assessed.scored).toBe(false);
    });

    test('a missing stat reports no rank rather than a zero-filled Excellent', () => {
        const assessed = assessStat('boneCount', undefined, 'standalonewindows');
        expect(assessed.rank).toBeNull();
        expect(assessed.value).toBeNull();
    });

    test('the rank ladder runs Excellent to VeryPoor', () => {
        expect(PERFORMANCE_RANKS).toEqual(['Excellent', 'Good', 'Medium', 'Poor', 'VeryPoor']);
    });
});

describe('bounds', () => {
    test('a model fitting the 2.5m cube is Excellent', () => {
        expect(assessBounds([2.5, 2.5, 2.5]).rank).toBe('Excellent');
    });

    test('one axis over 2.5 falls to the 4m tier', () => {
        expect(assessBounds([2.6, 2.5, 2.5]).rank).toBe('Good');
    });

    test('bounds uses the tightest tier that fits all three axes, not the worst axis alone', () => {
        expect(assessBounds([5, 6, 5]).rank).toBe('Medium');
        expect(assessBounds([5, 6, 5.1]).rank).toBe('VeryPoor');
    });

    test('the ratio is the most-binding axis against the Poor ceiling', () => {
        expect(assessBounds([1, 2, 5]).ratio).toBe(1);
        expect(assessBounds([2.5, 2.5, 2.5]).ratio).toBeCloseTo(0.5, 5);
    });

    test('a malformed bounds value is scored but not ranked', () => {
        const assessed = assessStat('bounds', [1, 2], 'standalonewindows');
        expect(assessed.rank).toBeNull();
        expect(assessed.scored).toBe(true);
        expect(assessStat('bounds', null, 'android').rank).toBeNull();
    });

    test('mobile shares the PC bounds tiers', () => {
        expect(isScoredMetric('bounds', 'mobile')).toBe(true);
        expect(assessStat('bounds', [3, 3, 3], 'android').rank).toBe('Good');
    });
});

describe('analysis record handling', () => {
    const scanned = {
        scanStatus: 'passed',
        performanceRating: 'Medium',
        avatarStats: { totalPolygons: 52200, boneCount: 236, bounds: [1.27, 1.78, 0.64], particleSystemCount: 0 },
        textureStats: { totalMippedBytes: 21894584 }
    };

    test('texture memory falls back to textureStats when avatarStats omits it', () => {
        expect(pickTextureBytes(scanned)).toBe(21894584);
        expect(
            pickTextureBytes({ avatarStats: { totalTextureUsage: 123 }, textureStats: { totalMippedBytes: 21894584 } })
        ).toBe(123);
        expect(pickTextureBytes(null)).toBeNull();
    });

    test('the fallback is ranked in MiB like the official table', () => {
        const rows = collectStatEntries(scanned, 'standalonewindows');
        const texture = rows.find((row) => row.key === 'totalTextureUsage');
        expect(texture.rank).toBe('Excellent');
        expect(texture.maximum).toBe(150);
    });

    test('an unscanned variant gets values but no ranks, so zeros never look Excellent', () => {
        const unscanned = {
            scanStatus: 'notScannedYet',
            performanceRating: 'None',
            avatarStats: { particleSystemCount: 0, boneCount: 236 }
        };
        expect(isAnalysisUsable(unscanned)).toBe(false);
        const rows = collectStatEntries(unscanned, 'android');
        expect(rows.find((row) => row.key === 'particleSystemCount').rank).toBeNull();
        expect(rows.find((row) => row.key === 'particleSystemCount').value).toBe(0);
        expect(rows.find((row) => row.key === 'boneCount').rank).toBeNull();
    });

    test('metrics with no official threshold stay unranked even when scanned', () => {
        const rows = collectStatEntries(
            {
                ...scanned,
                avatarStats: { ...scanned.avatarStats, materialCount: 16, blendShapeCount: 6, cameraCount: 1 }
            },
            'standalonewindows'
        );
        for (const key of ['materialCount', 'blendShapeCount', 'cameraCount']) {
            const row = rows.find((entry) => entry.key === key);
            expect(row.scored).toBe(false);
            expect(row.rank).toBeNull();
            expect(row.value).not.toBeNull();
        }
    });

    test('a missing avatarStats yields no rows instead of a table of dashes', () => {
        expect(collectStatEntries({ scanStatus: 'passed', performanceRating: 'Medium' }, 'android')).toEqual([]);
    });

    test('scanned analysis is usable', () => {
        expect(isAnalysisUsable(scanned)).toBe(true);
        expect(isAnalysisUsable(null)).toBe(false);
    });
});
