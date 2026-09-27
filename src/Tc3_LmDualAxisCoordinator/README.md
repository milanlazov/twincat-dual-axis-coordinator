# Tc3_LmDualAxisCoordinator: Developer Deep-Dive & Interface Specification

[![TwinCAT 3.1](https://badgen.net/badge/TwinCAT%203.1/Build%204026.x/green?scale=1.2)](https://www.beckhoff.com/) [![Dependency](https://badgen.net/badge/Dependency/Tc2_MC2/red?scale=1.2)](https://infosys.beckhoff.com/) [![Standard](https://badgen.net/badge/Standard/IEC%2061131-3/green?scale=1.2)](https://plcopen.org/)

The `Tc3_LmDualAxisCoordinator` library coordinates single-axis motion and dual-axis electronic gearing using explicit IEC 61131-3 state machines. Built on top of Beckhoff's `Tc2_MC2`, it organizes standard motion commands into deterministic controller and coordinator modules for industrial machines.

---

## Table of Contents
* **[1. Library Contents](#1-library-contents)**
* **[2. Industrial IEC 61131-3 Design Patterns](#2-industrial-iec-61131-3-design-patterns)**
  * [A. Eliminating Pin Clutter (Struct Bundling)](#a-eliminating-pin-clutter-struct-bundling)
  * [B. Memory Efficiency & Caller Protection (VAR_IN_OUT CONSTANT)](#b-memory-efficiency--caller-protection-var_in_out-constant)
  * [C. Defensive Working Copies in Hierarchical Control](#c-defensive-working-copies-in-hierarchical-control)
  * [D. Atomic Cycle-Boundary Output Mapping (_variables)](#d-atomic-cycle-boundary-output-mapping-_variables)
  * [E. Encapsulation via {attribute 'hide_all_locals'}](#e-encapsulation-via-attribute-hide_all_locals)
  * [F. Decoupled Cyclic Execution](#f-decoupled-cyclic-execution)
* **[3. FB_AxisController (Single-Axis Execution Layer)](#3-fb_axiscontroller-single-axis-execution-layer)**
  * [Interface Definition](#interface-definition)
  * [High-Priority Command Preemption](#high-priority-command-preemption)
  * [State Machine Architecture (4 Operational Regimes)](#state-machine-architecture-4-operational-regimes)
* **[4. FB_AxisDualDrive (Dual-Axis Equipment Module)](#4-fb_axisdualdrive-dual-axis-equipment-module)**
  * [Interface Definition](#interface-definition-1)
  * [Electronic Gearing Lifecycle States](#electronic-gearing-lifecycle-states)
  * [Pairing Topologies (E_DualDriveType)](#pairing-topologies-e_dualdrivetype)
  * [Coupling Policies (E_DualDriveCouplingPolicy)](#coupling-policies-e_dualdrivecouplingpolicy)
* **[5. Core Data Contracts](#5-core-data-contracts)**
  * [ST_AxisConfig](#st_axisconfig)
  * [ST_AxisSystemCmd](#st_axissystemcmd)
  * [E_AxisError](#e_axiserror)
* **[6. Implementation & Feature Demonstrations](#6-implementation--feature-demonstrations)**

---

## 1. Library Contents
The library contains the core motion control function blocks, internal validation helpers, and standardized data structures:

* **POUs:**
  * `FB_AxisController`: Single-axis execution engine managing power stages, kinematics, manual jogging, and controlled fault reset.
  * `FB_AxisDualDrive`: Dual-axis equipment module superintending master-slave electronic gearing, pairing topologies, and cross-axis safety policies.
  * `fValidateAxisConfig`: Internal parameter validation function checking configuration limits before motion execution.
  * `FB_AxisFeedbackMapping`: Internal cyclic NC status parser translating raw axis images into standardized feedback telemetry.
  * `FB_InputEdgeDetection`: Internal anti-latching helper conditioning command signals into clean, single-scan execution pulses.
* **DUTs:**
  * `E_AxisState`: Operational states for single-axis controllers (13 states).
  * `E_AxisCouplingState`: Electronic gearing lifecycle states for dual-axis coordination (5 states).
  * `E_AxisError`: Library diagnostic error codes (`16#8001` - `16#8024`).
  * `E_DualDriveCouplingPolicy`: Tandem power arbitration and uncoupling safety policies.
  * `E_DualDriveType`: Mechanical pairing topologies (`BI_PARTING`, `TELESCOPIC`, `CUSTOM`).
  * `ST_AxisConfig`: Dynamic kinematic profile limits, jog parameters, braking rates, and timeouts.
  * `ST_AxisSystemCmd`: Unified, interlocked command pipeline.
  * `ST_AxisFeedback` : Standardized cyclic process feedback image populated directly from the TwinCAT NC kernel.


---

## 2. Industrial IEC 61131-3 Design Patterns

### A. Eliminating Pin Clutter (Struct Bundling)
Exposing dozens of individual `VAR_INPUT` pins on a motion block leads to cluttered diagrams in graphical languages (CFC/FBD) and cumbersome call signatures in Structured Text.
* Operational commands are bundled into **`ST_AxisSystemCmd`**.
* Kinematic limits, jog parameters, and timeouts are bundled into **`ST_AxisConfig`**.

### B. Memory Efficiency & Caller Protection (`VAR_IN_OUT CONSTANT`)
Passing large structures via standard `VAR_INPUT` copies data into local instance memory on every PLC scan, creating CPU overhead. Standard `VAR_IN_OUT` avoids copies by passing a pointer, but allows the block to modify caller memory.
* Declaring structures as **`VAR_IN_OUT CONSTANT`** provides **zero-copy pointer execution speed** with **compiler-enforced caller immutability**.

### C. Defensive Working Copies in Hierarchical Control
In `FB_AxisDualDrive`, caller commands (`Axis_M_Cmd`, `Axis_S_Cmd`) are received as `VAR_IN_OUT CONSTANT` and cannot be mutated. However, a supervisory coordinator must be able to inject emergency stops, cross-axis interlocks, and power arbitration down to child controllers.
* The coordinator creates local working buffers at the start of each cycle:
  ```iec
  stMasterEffectiveCmd := Axis_M_Cmd;
  stSlaveEffectiveCmd  := Axis_S_Cmd;
  ```
* Cross-stops and interlocks are applied to these local copies, leaving caller memory in the application layer untouched.

### D. Atomic Cycle-Boundary Output Mapping (`_variables`)
Writing directly to public `VAR_OUTPUT` pins inside deep state branches can expose transient, incomplete states to external tasks or asynchronous ADS readers mid-cycle.
* All internal calculations write strictly to private backing variables (`_eCurrentState`, `_udiErrorId`, `_xError`).
* At the final lines of the routine, private registers are copied 1:1 to public `VAR_OUTPUT` pins. Externally, outputs are strictly **write-protected / read-only telemetry**.

### E. Encapsulation via `{attribute 'hide_all_locals'}`
Internal function blocks (`fbMoveAbsolute1`, `fbStop`), timers, and edge detectors are decorated with `{attribute 'hide_all_locals'}`. This keeps internal scratchpads hidden from TwinCAT IntelliSense and variable browsers, presenting the block strictly as a sealed industrial component.

### F. Decoupled Cyclic Execution
Standard PLCopen blocks (`MC_Power`, `MC_MoveAbsolute`, `MC_Stop`) maintain internal state machines, status flags, and ADS communication buffers. Calling these blocks conditionally inside `CASE` branches freezes their internal state processing when that branch is inactive.
* The state machine strictly determines **operational intent** (setting parameters, interlocks, and execution triggers).
* Encapsulated motion blocks are invoked **unconditionally outside the `CASE` structure at the bottom of the routine**, ensuring continuous NC cyclic processing on every scan.

---

## 3. `FB_AxisController` (Single-Axis Execution Layer)

### Interface Definition

| Pin | Type | Access | Description |
| :--- | :--- | :--- | :--- |
| `xAllowJog` | `BOOL` | `VAR_INPUT` | Permissive entry gate for manual jogging evaluated in `IDLE` and `HALTING`. |
| `xMotionInterlock` | `BOOL` | `VAR_INPUT` | Interlock input suppressing new motion initiation and retargeting. |
| `xEnablePositive` | `BOOL` | `VAR_INPUT` | Directional feed permissive forward (`MC_Power.Enable_Positive`, default: `TRUE`). |
| `xEnableNegative` | `BOOL` | `VAR_INPUT` | Directional feed permissive reverse (`MC_Power.Enable_Negative`, default: `TRUE`). |
| `xCalibrationCam` | `BOOL` | `VAR_INPUT` | Digital reference cam input for homing calibration (`MC_Home.bCalibrationCam`). |
| `AxisCmd` | `ST_AxisSystemCmd` | `VAR_IN_OUT CONSTANT` | Read-only reference to incoming command pipeline. |
| `AxisFeedback` | `ST_AxisFeedback` | `VAR_IN_OUT CONSTANT` | Read-only reference to cyclic NC process image. |
| `stConfig` | `ST_AxisConfig` | `VAR_IN_OUT CONSTANT` | Read-only reference to dynamic limits and configuration. |
| `Axis` | `AXIS_REF` | `VAR_IN_OUT` | Bidirectional interface linking PLC to the TwinCAT NC axis. |
| `eCurrentState` | `E_AxisState` | `VAR_OUTPUT` | Active operational state machine state. |
| `eActiveDirection` | `MC_Direction` | `VAR_OUTPUT` | Active travel direction tracked during continuous velocity motion. |
| `xError` | `BOOL` | `VAR_OUTPUT` | True if and only if `eCurrentState = E_AxisState.ERROR`. |
| `udiErrorId` | `UDINT` | `VAR_OUTPUT` | Latched diagnostic error ID (NC fault, drive trip, or `E_AxisError`). |

### High-Priority Command Preemption
Evaluated cyclically before executing active state logic:

> **NC Kernel / Drive Faults** &nbsp;➔&nbsp; **Hardware Power Loss** &nbsp;➔&nbsp; **Software Disable** &nbsp;➔&nbsp; **Stop (`MC_Stop`)** &nbsp;➔&nbsp; **Halt (`MC_Halt`)**

### State Machine Architecture (4 Operational Regimes)

| Regime | State | Operational Invariants & Mechanics | Exit Triggers |
| :--- | :--- | :--- | :--- |
| **1. Drive Power & Standby** | `OFF` | Drive bridge de-energized (`fbPower.Enable := FALSE`). Sweeps all motion command pins to `FALSE`. Resets retargeting toggle. | Deliberate rising edge on `xPowerEnable` $\to$ `POWERING`. |
| | `POWERING` | Asserts `fbPower.Enable := TRUE`. Supervises response against `stConfig.timPowerTimeout`. If already geared in NC kernel, routes directly to `GEARED`. | `fbPower.Status = TRUE` $\to$ `IDLE` (or `GEARED`); Timeout $\to$ `ERROR` (0x8001); Drive trip $\to$ `ERROR`. |
| | `IDLE` | Drive energized, holding closed-loop standstill. Sweeps execution pins to `FALSE`. Evaluates command triggers in strict priority sequence. | NC Coupling $\to$ `GEARED`; External motion $\to$ `EXTERNAL_MOTION`; Pulsed motion triggers $\to$ `HOMING`, `MOVEABS`, `MOVEVELO`, `JOGGING`. |
| **2. Trajectory & Motion** | `MOVEABS` | Executes positioning profile. Alternates between `fbMoveAbsolute1` and `fbMoveAbsolute2` (`BufferMode := MC_Aborting`) on fresh command edges to support on-the-fly retargeting. | Target coordinate reached (`Done`) $\to$ `IDLE`; Motion aborted $\to$ `HALTING`; Profile fault $\to$ `ERROR`. |
| | `MOVEVELO` | Accelerates to and maintains `lrMaxVelocity`. Alternates between `fbMoveVelocity1` and `fbMoveVelocity2` on dynamic parameter or direction updates mid-flight, eliminating scan-cycle latency or velocity drops. | Motion aborted $\to$ `HALTING`; Profile fault $\to$ `ERROR`. |
| | `JOGGING` | Continuous manual travel via `MC_Jog`. Arbitrates direction and speed conflicts dynamically. Releasing jog vectors routes to `HALTING` for controlled deceleration. | Conflicting inputs $\to$ `HALTING`; Button release $\to$ `HALTING`; Motion fault $\to$ `ERROR`. |
| | `HOMING` | Executes referencing calibration via `MC_Home` using configured mode and `xCalibrationCam`. Standstill entry required. | Calibration complete (`Done`) $\to$ `IDLE`; Motion aborted $\to$ `HALTING`; Fault $\to$ `ERROR`. |
| **3. Standstill & Safety Holds** | `HALTING` | Controlled deceleration ramp via `MC_Halt`. **Supports abortive preemption:** fresh positioning, velocity, or jog commands abort deceleration mid-ramp without waiting for standstill. | Standstill reached (`Done`) $\to$ `IDLE`; Override command $\to$ `MOVEABS` / `MOVEVELO` / `JOGGING`. |
| | `STOPPING` | Active deceleration stop via `MC_Stop`. Sets hard setpoint lock in NC kernel. Rejects new motion commands while asserted. | Standstill confirmed and `NOT xPowerEnable` $\to$ `OFF`; Standstill confirmed and `NOT xStop` $\to$ `IDLE`. |
| | `GEARED` | Axis setpoint generator is electronically coupled to a master trajectory via `MC_GearIn`. Structurally locks out independent positioning, homing, and jogging commands. | NC coupling flag dropped (`NOT AxisFeedback.xInGear`) $\to$ `IDLE`. |
| | `EXTERNAL_MOTION` | Physical movement detected in `IDLE` originating outside PLC control (NC Online Tab F1–F4 or external ADS commands). Publishes truthful telemetry. | Standstill verified (`NOT AxisFeedback.xMoving`) $\to$ `IDLE` (if powered) or `OFF`. |
| **4. Diagnostics & Recovery** | `RESET` | **Smart Dual-Domain Recovery Handshake:** Software errors clear internally without issuing an NC reset block command. True NC hardware trips execute `MC_Reset` and await cyclic process image confirmation (`NOT AxisFeedback.xError`). | Recovery verified and powered $\to$ `IDLE`; Recovery verified and unpowered $\to$ `OFF`; Reset error $\to$ `ERROR`. |
| | `ERROR` | Universal fail-safe rest state. Sweeps execution triggers to `FALSE`. Retains `fbPower.Enable := TRUE` to preserve holding torque during soft faults. | Rising edge on `xReset` $\to$ `RESET`; External NC Online Tab fault reset detected via falling edge $\to$ `IDLE` / `OFF`. |

---

## 4. `FB_AxisDualDrive` (Dual-Axis Equipment Module)

### Interface Definition

| Pin | Type | Access | Description |
| :--- | :--- | :--- | :--- |
| `eCouplingPolicy` | `E_DualDriveCouplingPolicy`| `VAR_INPUT` | Dynamic tandem power, uncoupling, and cross-stopping policy. |
| `eDriveType` | `E_DualDriveType` | `VAR_INPUT` | Mechanical pairing topology (Bi-Parting, Telescopic, Custom). |
| `lrRatioNumerator` | `LREAL` | `VAR_INPUT` | Custom ratio numerator (evaluated when `eDriveType = CUSTOM`, default: `-1.0`). |
| `iRatioDenominator` | `INT` | `VAR_INPUT` | Custom ratio denominator (must be `> 0`, default: `1`). |
| `xCmdGearIn` | `BOOL` | `VAR_INPUT` | Command input to synchronize axes (internally edge-detected via `R_TRIG`). |
| `xCmdGearOut` | `BOOL` | `VAR_INPUT` | Command input to decouple axes (internally edge-detected via `R_TRIG`). |
| `xCmdReset` | `BOOL` | `VAR_INPUT` | Command input to reset coordinator and faulted child axes (internally edge-detected via `R_TRIG`). |
| `xMasterCalibrationCam` | `BOOL` | `VAR_INPUT` | Reference homing calibration cam switch signal for Master axis referencing. |
| `xSlaveCalibrationCam` | `BOOL` | `VAR_INPUT` | Reference homing calibration cam switch signal for Slave axis referencing. |
| `Axis_M_Cmd` | `ST_AxisSystemCmd` | `VAR_IN_OUT CONSTANT` | Read-only reference to master command pipeline. |
| `Axis_S_Cmd` | `ST_AxisSystemCmd` | `VAR_IN_OUT CONSTANT` | Read-only reference to slave command pipeline. |
| `Axis_M_Config` | `ST_AxisConfig` | `VAR_IN_OUT CONSTANT` | Read-only reference to master profile dynamics. |
| `Axis_S_Config` | `ST_AxisConfig` | `VAR_IN_OUT CONSTANT` | Read-only reference to slave profile dynamics. |
| `Axis_Master` | `AXIS_REF` | `VAR_IN_OUT` | Hardware NC interface for Master axis. |
| `Axis_Slave` | `AXIS_REF` | `VAR_IN_OUT` | Hardware NC interface for Slave axis. |
| `eAxisCouplingState` | `E_AxisCouplingState` | `VAR_OUTPUT` | Active electronic gearing lifecycle state. |
| `xRegearRequired` | `BOOL` | `VAR_OUTPUT` | True if configured ratio differs from active ratio locked in NC kernel. |
| `lrActiveRatioNum` | `LREAL` | `VAR_OUTPUT` | Active ratio numerator locked in NC setpoint generator. |
| `uiActiveRatioDenom` | `UINT` | `VAR_OUTPUT` | Active ratio denominator locked in NC setpoint generator. |
| `xError` | `BOOL` | `VAR_OUTPUT` | True if coordinator or either child controller is in `ERROR`. |
| `udiErrorId` | `UDINT` | `VAR_OUTPUT` | Prioritized system diagnostic fault ID. |
| `eMasterState` | `E_AxisState` | `VAR_OUTPUT` | Active operational state of encapsulated Master controller. |
| `udiMasterErrorId` | `UDINT` | `VAR_OUTPUT` | Diagnostic error ID originating from Master axis. |
| `eSlaveState` | `E_AxisState` | `VAR_OUTPUT` | Active operational state of encapsulated Slave controller. |
| `udiSlaveErrorId` | `UDINT` | `VAR_OUTPUT` | Diagnostic error ID originating from Slave axis. |
| `stMasterFeedback` | `ST_AxisFeedback` | `VAR_OUTPUT` | Cyclic NC process feedback image for Master axis. |
| `stSlaveFeedback` | `ST_AxisFeedback` | `VAR_OUTPUT` | Cyclic NC process feedback image for Slave axis. |

### Electronic Gearing Lifecycle States

| Coupling State | Operational Invariants & Mechanics | Exit Triggers |
| :--- | :--- | :--- |
| `UNSYNCED` | Axes operate independently. Slave manual jogging permitted (`xSlaveAllowJog := TRUE`). Gearing execution pins held low. | Rising edge on `xCmdGearIn` (gated by both axes in `IDLE` at standstill) $\to$ `GEARING_IN`; NC Online Tab external gear $\to$ `SYNCED`. |
| `GEARING_IN` | Commands `MC_GearIn` using resolved ratio and slave acceleration limits. Asserts `xMotionInterlock := TRUE` to suppress independent child motion. | `fbGearIn.InGear` confirmed $\to$ `SYNCED`; Profile aborted by NC kernel $\to$ `ERROR` (0x8012); Power dropped mid-sync $\to$ `GEARING_OUT` / `ERROR`. |
| `SYNCED` | Electronic gear locked in NC setpoint generator. Slave follows Master trajectory. Slave manual jogging locked out (`xSlaveAllowJog := FALSE`). Dynamic ratio changes assert `xRegearRequired := TRUE`. | Physical NC coupling lost $\to$ `UNSYNCED`; Power dropped with decoupling policy $\to$ `GEARING_OUT`; `xCmdGearOut` pulse $\to$ `GEARING_OUT`; Re-gear pulse at standstill $\to$ `GEARING_OUT`. |
| `GEARING_OUT` | Commands `MC_GearOut` to dissolve setpoint link. If uncoupled while moving, the coordinator automatically commands an active stop on the slave to prevent continuous drifting. | `fbGearOut.Done` (standard decouple) $\to$ `UNSYNCED`; `fbGearOut.Done` (re-gear sequence) $\to$ `GEARING_IN`; `fbGearOut.Done` (following abort) $\to$ `ERROR`. |
| `ERROR` | Universal fail-safe rest state. Sweeps gearing execution pins to `FALSE`. | Reset handshake verified across coordinator memory, NC cyclic images, and child controllers $\to$ `SYNCED` (if coupling survived) or `UNSYNCED`. |

### Pairing Topologies (`E_DualDriveType`)

The mechanical gearing relationship is selected via `eDriveType`:

| Topology (`eDriveType`) | Gear Ratio ($N : D$) | Kinematic Motion Profile | Industrial Application Examples |
| :--- | :--- | :--- | :--- |
| **`BI_PARTING`** | `-1.0 : 1` | Opposing travel at equal speed | Center-opening safety doors, symmetric grippers/clamps |
| **`TELESCOPIC`** | `+2.0 : 1` | Parallel travel at $2\times$ master speed | Multi-stage extending booms, telescopic transfer forks |
| **`CUSTOM`** | Dynamic ($N : D$) | Configured via `lrRatioNumerator` and `iRatioDenominator` | Custom gearbox reductions, unequal timing pulleys, eccentric cam links |

> **Runtime Denominator Validation (`CUSTOM` Topology):**  
> In TwinCAT NC, `MC_GearIn.RatioDenominator` strictly requires an unsigned positive integer (`UINT > 0`). When `CUSTOM` is selected, `iRatioDenominator` is validated at runtime before issuing the gearing command:
> * **Denominator = 0:** Trapped immediately as `ERR_RATIO_DIV_ZERO` (`16#8010`) to eliminate floating-point divide-by-zero crashes.
> * **Denominator < 0:** Trapped immediately as `ERR_RATIO_DENOM_NEGATIVE` (`16#8011`). Negative values are rejected; directional inversions must be configured using the numerator (`lrRatioNumerator`).

### Coupling Policies (`E_DualDriveCouplingPolicy`)

| Policy | Power Cycles | Power-Down Decoupling | Power Permissives | Master Cross-Stop on Decouple |
| :--- | :--- | :--- | :--- | :--- |
| **`PERSISTENT_TANDEM`** | Retains coupling across power drops. | **Disabled:** Axes remain coupled in NC kernel. | **Dual-Permissive:** Both stations must enable power to energize either drive. | **Enforced:** Master stops if slave decouples or faults. |
| **`MODULAR_TANDEM_STOP`**| Decouples on power disable. | **Enabled:** Automatically calls `MC_GearOut` on disable. | **Independent:** Axes can power up independently. | **Enforced:** Master stops if slave decouples or faults. |
| **`MODULAR_INDEPENDENT`**| Decouples on power disable. | **Enabled:** Automatically calls `MC_GearOut` on disable. | **Independent:** Axes can power up independently. | **Autonomous:** Master continues trajectory if slave decouples. |

---

## 5. Core Data Contracts

### `ST_AxisConfig`
Kinematic limits, jog parameters, braking dynamics, and supervisory timeouts.

| Parameter | Type | Valid Limits | Description |
| :--- | :--- | :--- | :--- |
| `lrMaxVelocity` | `LREAL` | `> 0.0` | Maximum velocity setpoint for positioning profiles. |
| `lrMaxAcceleration` | `LREAL` | `> 0.0` | Acceleration rate for positioning profiles. |
| `lrMaxDeceleration` | `LREAL` | `> 0.0` | Deceleration rate for positioning profiles. |
| `lrMaxJerk` | `LREAL` | `>= 0.0` | S-curve jerk rate (`0.0` = trapezoidal profile). |
| `lrJogBkwFastVelocity` | `LREAL` | `> 0.0` | Reverse fast manual jog velocity. |
| `lrJogBkwSlowVelocity` | `LREAL` | `> 0.0` | Reverse slow manual jog velocity. |
| `lrJogFwdSlowVelocity` | `LREAL` | `> 0.0` | Forward slow manual jog velocity. |
| `lrJogFwdFastVelocity` | `LREAL` | `> 0.0` | Forward fast manual jog velocity. |
| `lrJogAcceleration` | `LREAL` | `> 0.0` | Manual jog acceleration rate. |
| `lrJogDeceleration` | `LREAL` | `> 0.0` | Manual jog deceleration rate. |
| `lrJogJerk` | `LREAL` | `>= 0.0` | Manual jog S-curve smoothing jerk. |
| `lrStopDeceleration` | `LREAL` | `> 0.0` | Active stop deceleration rate (`MC_Stop`). |
| `lrStopJerk` | `LREAL` | `>= 0.0` | Active stop jerk rate. |
| `lrHaltDeceleration` | `LREAL` | `> 0.0` | Controlled halt deceleration rate (`MC_Halt`). |
| `lrHaltJerk` | `LREAL` | `>= 0.0` | Controlled halt jerk rate. |
| `lrTargetPosition` | `LREAL` | Any | Target position for absolute moves (`MC_MoveAbsolute`). |
| `eActiveDirection` | `MC_Direction` | Valid Enum | Motion direction for velocity moves (`MC_MoveVelocity`). |
| `lrHomePosition` | `LREAL` | Any | Reference coordinate assigned upon homing calibration. |
| `eHomingMode` | `MC_HomingMode`| Valid Enum | Calibration mode passed to `MC_Home`. |
| `timPowerTimeout` | `TIME` | `> T#0S` | Max duration to confirm drive enable (`Default: T#5S`). |
| `timJitterTolerance` | `TIME` | `> T#0S` | Standstill jitter filter window (`Default: T#100MS`). |

### `ST_AxisSystemCmd`
Conditioned command pipeline consumed by controllers and coordinators.

| Member | Type | Signal Profile | Description |
| :--- | :--- | :--- | :--- |
| `xPowerEnable` | `BOOL` | Level / Maintained | Drive power request. Edge-filtered internally from `OFF` for anti-restart protection. |
| `xMoveAbs` | `BOOL` | Dynamic Trigger | Absolute move request. Edge-filtered internally; triggers on-the-fly retargeting. |
| `xMoveVelo` | `BOOL` | Dynamic Trigger | Velocity move request. Edge-filtered internally. |
| `xJogBkwFast` | `BOOL` | Level / Maintained | Sustained reverse fast jog command. |
| `xJogBkwSlow` | `BOOL` | Level / Maintained | Sustained reverse slow jog command. |
| `xJogFwdSlow` | `BOOL` | Level / Maintained | Sustained forward slow jog command. |
| `xJogFwdFast` | `BOOL` | Level / Maintained | Sustained forward fast jog command. |
| `xHalt` | `BOOL` | Dynamic Trigger | Controlled deceleration halt request. Edge-filtered internally. |
| `xStop` | `BOOL` | Level / Maintained | Active stop and setpoint lock request. |
| `xHome` | `BOOL` | Dynamic Trigger | Coordinate referencing request. Edge-filtered internally. |
| `xReset` | `BOOL` | Dynamic Trigger | Fault reset request. Edge-filtered internally. |

### `E_AxisError`
Library diagnostic codes mapped to `udiErrorId`.

| Code | Identifier | Origin | Description |
| :--- | :--- | :--- | :--- |
| `16#0000` | `NO_ERROR` | System | Subsystem healthy; no active faults. |
| `16#8001` | `ERR_POWER_TIMEOUT` | Single-Axis Controller | Drive power stage failed to report operational ready within `timPowerTimeout`. |
| `16#8002` | `ERR_HALT_ABORTED` | Single-Axis Controller | `MC_Halt` deceleration profile aborted prematurely by external NC preemption. |
| `16#8003` | `ERR_STOP_ABORTED` | Single-Axis Controller | `MC_Stop` deceleration profile aborted prematurely by external NC preemption. |
| `16#8010` | `ERR_RATIO_DIV_ZERO` | Dual-Axis Coordinator | Custom gear ratio denominator configured to zero. |
| `16#8011` | `ERR_RATIO_DENOM_NEGATIVE`| Dual-Axis Coordinator | Custom gear ratio denominator configured with a negative integer (`<= 0`). |
| `16#8012` | `ERR_GEARIN_ABORTED` | Dual-Axis Coordinator | `MC_GearIn` coupling sequence aborted prematurely by NC kernel. |
| `16#8013` | `ERR_GEAROUT_ABORTED` | Dual-Axis Coordinator | `MC_GearOut` decoupling sequence aborted prematurely by NC kernel. |
| `16#8020` | `ERR_CONFIG_POWER_TIMEOUT` | Parameter Validation | `timPowerTimeout` configured `<= T#0S`. |
| `16#8021` | `ERR_CONFIG_STOP_DECEL` | Parameter Validation | Stop dynamics invalid (`lrStopDeceleration <= 0.0` or `lrStopJerk < 0.0`). |
| `16#8022` | `ERR_CONFIG_HALT_DECEL` | Parameter Validation | Halt dynamics invalid (`lrHaltDeceleration <= 0.0` or `lrHaltJerk < 0.0`). |
| `16#8023` | `ERR_CONFIG_MOTION_DYNAMICS`| Parameter Validation | Profile dynamics invalid (velocity, acc, or dec `<= 0.0`, or jerk `< 0.0`). |
| `16#8024` | `ERR_CONFIG_JOG_DYNAMICS` | Parameter Validation | Jog dynamics invalid (any jog velocity, acc, or dec `<= 0.0`, or jerk `< 0.0`). |

> **Note:** Diagnostic codes in the range `16#4000` to `16#4FFF` originate directly from the Beckhoff NC kernel or drive amplifier firmware and pass through transparently to `udiErrorId`.

---

## 6. Implementation & Feature Demonstrations

For complete application setup, virtual axis simulation, and video walkthroughs of all motion features:

* **[Virtual Commissioning Setup & SOP](../ComissioningExample/README.md)**: Hardware mapping, offline PC simulation, and run-mode activation.
* **[Live Feature Video Gallery](../ComissioningExample/README.md#3-live-feature-demonstrations)**: 13 individual video demonstrations covering retargeting, policy enforcement, decoupling mid-motion, external motion tracking, fault recovery and more.