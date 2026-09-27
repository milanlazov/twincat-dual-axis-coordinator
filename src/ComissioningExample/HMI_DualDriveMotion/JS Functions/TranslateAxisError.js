// Keep these lines for a best effort IntelliSense in the editor.
// When this file is migrated to TypeScript in the future this line must be removed.
/// <reference path="./../Packages/Beckhoff.TwinCAT.HMI.Framework.14.6.3/runtimes/native1.12-tchmi/TcHmi.d.ts" />

function TranslateAxisError(par1) {
    var code = Number(par1);

    if (isNaN(code) || code === 0) {
        return "OK\nNo active faults on this subsystem.";
    }

    var hexCode = "0x" + code.toString(16).toUpperCase().padStart(4, "0");

    switch (code) {
        // --- Single-Axis Controller Runtime Faults (0x8001 - 0x800F) ---
        case 0x8001: case 32769:
            return hexCode + " [ERR_POWER_TIMEOUT]\nDrive power stage failed to report ready within timeout.";
        case 0x8002: case 32770:
            return hexCode + " [ERR_HALT_ABORTED]\nMC_Halt profile unexpectedly aborted before standstill.";
        case 0x8003: case 32771:
            return hexCode + " [ERR_STOP_ABORTED]\nMC_Stop profile unexpectedly aborted before standstill.";

        // --- Dual-Axis Coordinator Faults (0x8010 - 0x801F) ---
        case 0x8010: case 32784:
            return hexCode + " [ERR_RATIO_DIV_ZERO]\nCustom gear ratio denominator cannot be zero.";
        case 0x8011: case 32785:
            return hexCode + " [ERR_RATIO_DENOM_NEGATIVE]\nGear ratio denominator must be a positive integer (> 0).";
        case 0x8012: case 32786:
            return hexCode + " [ERR_GEARIN_ABORTED]\nMC_GearIn coupling sequence aborted by NC kernel.";
        case 0x8013: case 32787:
            return hexCode + " [ERR_GEAROUT_ABORTED]\nMC_GearOut decoupling sequence aborted by NC kernel.";

        // --- Single-Axis Configuration Faults (0x8020 - 0x802F) ---
        case 0x8020: case 32800:
            return hexCode + " [ERR_CONFIG_POWER_TIMEOUT]\ntimPowerTimeout configuration must be greater than T#0s.";
        case 0x8021: case 32801:
            return hexCode + " [ERR_CONFIG_STOP_DECEL]\nActive stop deceleration must be > 0.0 and jerk >= 0.0.";
        case 0x8022: case 32802:
            return hexCode + " [ERR_CONFIG_HALT_DECEL]\nControlled halt deceleration must be > 0.0 and jerk >= 0.0.";
        case 0x8023: case 32803:
            return hexCode + " [ERR_CONFIG_MOTION_DYNAMICS]\nTrajectory dynamics invalid: Velocity, Accel, Decel <= 0.0.";
        case 0x8024: case 32804:
            return hexCode + " [ERR_CONFIG_JOG_DYNAMICS]\nJog dynamics invalid: Selected speed, Accel, Decel <= 0.0.";

        default:
            // TwinCAT NC Kernel / Drive Hardware Errors (0x4000 - 0x4FFF)
            if (code >= 0x4000 && code <= 0x4FFF) {
                return hexCode + " [NC_KERNEL_TRIP]\nHardware trip or NC-SAF error. Refer to TwinCAT NC Log.";
            }
            return hexCode + " [UNKNOWN_FAULT]\nUnregistered diagnostic error code.";
    }
}

TcHmi.Functions.registerFunctionEx(
    'TranslateAxisError',
    'TcHmi.Functions.HMI_DualDriveMotion',
    TranslateAxisError
);

// Expose globally so it can be called directly in fx fields
window.TranslateAxisError = TranslateAxisError;
