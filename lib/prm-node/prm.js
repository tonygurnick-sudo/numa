"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRM_UA = exports.PRODUCT_CODE = void 0;
exports.withPRM = withPRM;
exports.PRODUCT_CODE = 'cl23v3vsno0k35czlg7e3ld9p';
exports.PRM_UA = `APN/1.1 (${exports.PRODUCT_CODE})`;
function withPRM(ClientConstructor, config = {}) {
    const existingUserAgent = config.customUserAgent || [];
    const mergedConfig = {
        ...config,
        customUserAgent: Array.isArray(existingUserAgent)
            ? [exports.PRM_UA, ...existingUserAgent]
            : [exports.PRM_UA, existingUserAgent],
    };
    return new ClientConstructor(mergedConfig);
}
