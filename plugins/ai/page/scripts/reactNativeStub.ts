export const StyleSheet = { hairlineWidth: 0.5, create: <T>(styles: T) => styles, absoluteFillObject: {} };
export const Platform = { OS: "macos", select: <T>(options: { default?: T; macos?: T }) => options.macos ?? options.default };
export const PixelRatio = { get: () => 2 };
const curve = () => (t: number) => t;
export const Easing = { bezier: curve, linear: (t: number) => t, ease: (t: number) => t, out: curve, in: curve, inOut: curve, quad: (t: number) => t, cubic: (t: number) => t, exp: (t: number) => t, sin: (t: number) => t };
export const Animated = { Value: class {}, timing: () => ({ start: () => undefined }), spring: () => ({ start: () => undefined }) };
export const AccessibilityInfo = { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove: () => undefined }) };
