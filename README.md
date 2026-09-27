# 🏭 TwinCAT 3 Dual-Axis Motion Coordinator

![Library](https://flat.badgen.net/badge/Library/Tc3_LmDualAxisCoordinator/blue?scale=1.4) ![Version](https://flat.badgen.net/badge/Version/v1.0.0.0/grey?scale=1.4) ![TwinCAT 3](https://flat.badgen.net/badge/TwinCAT%203.1/Build%204026/green?scale=1.4) ![Dependency](https://flat.badgen.net/badge/Dependency/Tc2_MC2/red?scale=1.4) ![Standard](https://flat.badgen.net/badge/Standard/IEC%2061131--3/green?scale=1.4)

A production-grade, encapsulated TwinCAT 3 motion control library designed to manage single-axis kinematics and coordinate dual-axis mechanical topologies. Built on top of the standard Beckhoff `Tc2_MC2` PLCopen library, it uses explicit state machines to coordinate master/slave synchronization, dynamic trajectory updates, and fault recovery while keeping cyclic execution clean and decoupled.

This repository provides the core `.compiled-library` (featuring `FB_AxisController`, `FB_AxisDualDrive`, and internal helpers) alongside a complete **Zero-Hardware Virtual Commissioning Example** to demonstrate the code in action.

---

## 🎥 System Demonstration: The 60-Second Overview

The following sequence demonstrates the library's physical invariant guarding, anti-restart protection, and dynamic motion coordination:

https://github.com/user-attachments/assets/1aa43de6-1781-490f-b971-03235392b34f

**What you are seeing in this sequence:**
1. **Invariant Guarding:** The system boots with unconfigured kinematic limits (`0.00`). When power is requested, the controller's validation block (`fValidateAxisConfig`) intercepts the invalid parameters and blocks the transition, preventing inevitable NC trajectory faults.
2. **Anti-Restart Safety Interlock:** After tuning the parameters and clearing the fault, the drives do not automatically re-energize—even though the power switch is a maintained toggle left in the `ON` position. The operator must deliberately cycle the switch to generate a fresh rising edge, strictly enforcing anti-restart safety.
3. **Dynamic Topology Selection:** The coordinator is set to a `PERSISTENT_TANDEM` policy with a `CUSTOM` (3.0:1) mechanical gear ratio.
4. **Ping-Pong Retargeting:** An absolute move is commanded. Mid-flight, the target destination is changed. The controller absorbs the new absolute coordinate on-the-fly without an intermediate standstill or velocity drop.

---

## ⚡ Core Architectural Features

This framework is engineered to handle edge cases, deadlock prevention, and mechanical realities that go beyond standard motion tutorials:

* **Two-Instance Ping-Pong Trajectory Retargeting (`MoveAbs` & `MoveVelocity`):**  
  Solves the classic PLC motion limitation where issuing a new target or speed to an active function block causes velocity dips or command rejection. Alternates execution between dual function block pairs (`fbMoveAbsolute1`/`fbMoveAbsolute2` and `fbMoveVelocity1`/`fbMoveVelocity2` using `MC_Aborting`). New target coordinates, velocity setpoints, or directional changes are recalculated and executed smoothly mid-flight without an execution deadband or intermediate standstill.
* **Configurable Coupling Policies:** Dual-drive behavior adapts to the mechanics. `PERSISTENT_TANDEM` enforces rigid mechanical coupling across power cycles with unified dual-permissive power. `MODULAR_TANDEM_STOP` automatically decouples on disable but ensures a moving master executes a controlled cross-axis stop if its slave faults. `MODULAR_INDEPENDENT` allows the master to autonomously continue its trajectory.
* **Smart Dual-Domain Fault Recovery:** Intelligently differentiates between PLC software faults (e.g., power timeouts, configuration errors) and physical TwinCAT NC hardware trips. Resets are strictly dispatched based on the active fault domain, preventing nuisance errors caused by resetting healthy NC axes.
* **Latched Signal Protection:** All commands (Power, Move, Halt, Reset) are edge-filtered internally. This guarantees that jammed hardware pushbuttons or latched HMI toggles cannot trap the state machine in infinite execution loops.
* **Stationary Re-Gearing:** Electronic gear ratios can be updated dynamically. Pulsing the gear command while the axes are resting at standstill initiates an automated decouple-and-recouple sequence to apply the new ratio.

> **Note:** The library includes additional production features such as dual-instance ping-pong velocity retargeting for continuous moves, manual jog speed arbitration, customizable homing modes, and continuous diagnostic tracking. For video walkthroughs and operational demonstrations of each feature, see the **[Live Feature Demonstrations](src/ComissioningExample/README.md#3-live-feature-demonstrations)** in the Commissioning Guide.

---


  ## 🗺️ Repository Structure & Quick Links

* 📦 **[`/dist`](./dist/)**  
  *Contains the ready-to-use, pre-compiled library file (`Tc3_LmDualAxisCoordinator.compiled-library`) for direct installation into your TwinCAT 3 Library Repository.*

* 📂 **[`/src/Tc3_LmDualAxisCoordinator`](./src/Tc3_LmDualAxisCoordinator/README.md)**  
  *The core library source code. Click here for the Function Block instances, Data Structures, and IEC 61131-3 design patterns (Cycle-Boundary Mapping, Data Encapsulation).*

* 📂 **[`/src/ComissioningExample`](./src/ComissioningExample/README.md)**  
  *The TwinCAT 3 Commissioning Solution. Click here for Prerequisites, Library Installation Instructions, the Virtual Commissioning SOP, and the full Feature Video Gallery (featuring a custom TF2000 HMI).*

* 📁 **[`/docs`](./docs/)**  
  *Contains media assets, visual documentation, and demo recordings.*

