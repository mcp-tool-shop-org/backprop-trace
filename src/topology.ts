/**
 * v0.3 generalized topology types — explicit unit/parameter declarations
 * + a validator.
 *
 * v0.1 hardcoded the Mazur 2-2-2 topology (4 inputs (counting i1/i2 + bias
 * x2), 4 hidden units across the 2 hidden + 2 output groups, 8 weights +
 * 2 per-layer biases). v0.3 generalizes that by declaring the topology as
 * data: a `Topology` value lists every input/hidden/output unit by id, lists
 * every parameter by id + role + which units it connects, and pins the
 * iteration order so the engine's computation order remains deterministic
 * across topologies.
 *
 * Vocabulary follows the design memo's KEEP-units-NOT-ONNX-nodes decision
 * (memo §1): units + parameters, not nodes[]. The ONNX migration is
 * deferred to v0.4+.
 *
 * Topology declarations are immutable (`readonly` everywhere). Callers
 * that want to derive a new topology should construct a fresh literal
 * rather than mutating an existing one.
 *
 * The Mazur topology declared as `MAZUR_TOPOLOGY` in src/mazur.ts (and
 * the XOR + iris topologies declared there as well) is what consumers feed
 * into `runGeneralStep`. The engine then iterates units in
 * `topology.unit_order` order and parameters in `topology.parameter_order`
 * order — both sequences are part of the topology's identity, so two
 * topologies that disagree on iteration order are different topologies
 * even if they describe the same graph.
 */

export type UnitId = string

export type ParameterId = string

/**
 * Iteration order for units within each layer. The engine walks units
 * in this exact order; reordering changes the floating-point sum order
 * in hidden-layer net computations and is therefore part of the topology's
 * pinned identity.
 */
export type UnitOrder = {
  readonly input: readonly UnitId[]
  readonly hidden: readonly UnitId[]
  readonly output: readonly UnitId[]
}

/**
 * Parameter role — names the structural slot the parameter fills in the
 * forward/backward equations. Weights connect two units; biases apply to
 * a whole layer (v0.3 supports per_layer bias sharing only — per_neuron
 * is deferred to v0.4+ per design memo §5).
 */
export type ParameterRole =
  | "input_to_hidden_weight"
  | "hidden_to_output_weight"
  | "hidden_bias"
  | "output_bias"

/**
 * Per-parameter metadata. Weights have from_unit + to_unit; biases have
 * applies_to_units (a list of all units in the layer they bias). The
 * engine's `findWeight` / `findHiddenBias` / `findOutputBias` helpers
 * scan `parameters[]` to resolve each operand at forward/backward time.
 */
export type Parameter = {
  readonly id: ParameterId
  readonly role: ParameterRole
  readonly from_unit?: UnitId
  readonly to_unit?: UnitId
  readonly applies_to_units?: readonly UnitId[]
}

/**
 * The full topology declaration consumed by `runGeneralStep`. Pins
 * everything the engine needs to deterministically run forward/backward/
 * update: layer ordering, unit-within-layer iteration order, parameter
 * iteration order for the update phase, activation per layer, loss,
 * bias-sharing strategy, and per-layer sizes (redundant with unit_order
 * lengths but kept explicit for both human readability and validator
 * cross-checking).
 */
export type Topology = {
  readonly layers: readonly ["input", "hidden", "output"]
  readonly unit_order: UnitOrder
  readonly parameter_order: readonly ParameterId[]
  readonly parameters: readonly Parameter[]
  readonly activation_hidden: "sigmoid" | "identity" | "relu"
  readonly activation_output: "sigmoid" | "identity" | "relu"
  readonly loss: "half_squared_error"
  readonly bias_sharing: "per_layer"
  readonly input_size: number
  readonly hidden_size: number
  readonly output_size: number
}

/**
 * Validate structural invariants on a Topology literal. Throws on the
 * first violation with a path-naming Error so a malformed topology fails
 * fast at the engine boundary.
 *
 * Invariants checked:
 *  1. `unit_order.{input,hidden,output}` lengths match `{input,hidden,
 *     output}_size`.
 *  2. Unit ids are unique across all three layers (no h1 reused as o1,
 *     etc.) — required because forward/backward writes into a single
 *     id-keyed map.
 *  3. `parameter_order` length matches `parameters[]` length and the
 *     i-th id in `parameter_order` is the i-th `parameters[i].id` — i.e.
 *     `parameter_order` is the projection of `parameters[]` ids in
 *     declared order. Pinning this keeps update iteration byte-stable.
 *  4. Parameter ids are unique.
 *  5. Each weight has `from_unit` + `to_unit`, and both are resolvable
 *     to declared units in the correct adjacent layers. input_to_hidden
 *     weights connect input -> hidden; hidden_to_output weights connect
 *     hidden -> output.
 *  6. Each bias has `applies_to_units` listing the entire hidden or
 *     output layer (per_layer sharing — every unit in the layer must
 *     appear exactly once).
 *  7. Activations are in the supported set ({sigmoid, identity, relu}).
 *
 * Returns void on success; throws on first violation.
 */
export function assertTopologyValid(t: Topology): void {
  // 1. Size matches unit_order arrays
  if (t.unit_order.input.length !== t.input_size) {
    throw new Error(
      `Topology: unit_order.input has ${t.unit_order.input.length} units but input_size is ${t.input_size}. ` +
        `Hint: unit_order.input must list exactly input_size unit ids in iteration order.`,
    )
  }
  if (t.unit_order.hidden.length !== t.hidden_size) {
    throw new Error(
      `Topology: unit_order.hidden has ${t.unit_order.hidden.length} units but hidden_size is ${t.hidden_size}. ` +
        `Hint: unit_order.hidden must list exactly hidden_size unit ids in iteration order.`,
    )
  }
  if (t.unit_order.output.length !== t.output_size) {
    throw new Error(
      `Topology: unit_order.output has ${t.unit_order.output.length} units but output_size is ${t.output_size}. ` +
        `Hint: unit_order.output must list exactly output_size unit ids in iteration order.`,
    )
  }

  // 2. Unit ids unique across layers
  const allUnits = [...t.unit_order.input, ...t.unit_order.hidden, ...t.unit_order.output]
  const totalUnits = t.input_size + t.hidden_size + t.output_size
  const unitSet = new Set(allUnits)
  if (unitSet.size !== totalUnits) {
    throw new Error(
      `Topology: duplicate unit ids across layers. ` +
        `Hint: every input/hidden/output unit id must be globally unique; ` +
        `forward and backward maps are keyed by unit id without layer prefix.`,
    )
  }

  // 3 + 4. parameter_order projection + uniqueness
  if (t.parameters.length !== t.parameter_order.length) {
    throw new Error(
      `Topology: parameters[] has ${t.parameters.length} entries but parameter_order has ${t.parameter_order.length}. ` +
        `Hint: parameter_order is the iteration-order projection of parameters[] ids and must have equal length.`,
    )
  }
  const seenParamIds = new Set<string>()
  for (let i = 0; i < t.parameters.length; i++) {
    const p = t.parameters[i]!
    const expected = t.parameter_order[i]!
    if (p.id !== expected) {
      throw new Error(
        `Topology: parameters[${i}].id is '${p.id}' but parameter_order[${i}] is '${expected}'. ` +
          `Hint: parameters[i].id MUST equal parameter_order[i] for every i — these two sequences must agree.`,
      )
    }
    if (seenParamIds.has(p.id)) {
      throw new Error(
        `Topology: parameter id '${p.id}' appears more than once. ` +
          `Hint: every parameter must have a globally unique id.`,
      )
    }
    seenParamIds.add(p.id)
  }

  // 5 + 6. Per-parameter structural checks
  const inputSet = new Set(t.unit_order.input)
  const hiddenSet = new Set(t.unit_order.hidden)
  const outputSet = new Set(t.unit_order.output)
  let hiddenBiasSeen = 0
  let outputBiasSeen = 0
  for (const p of t.parameters) {
    if (p.role === "input_to_hidden_weight") {
      if (p.from_unit === undefined || p.to_unit === undefined) {
        throw new Error(
          `Topology: parameter '${p.id}' has role 'input_to_hidden_weight' but is missing from_unit or to_unit. ` +
            `Hint: weights MUST declare both from_unit and to_unit.`,
        )
      }
      if (!inputSet.has(p.from_unit)) {
        throw new Error(
          `Topology: parameter '${p.id}' (input_to_hidden_weight) from_unit '${p.from_unit}' is not in unit_order.input. ` +
            `Hint: input_to_hidden_weight from_unit MUST be a declared input unit.`,
        )
      }
      if (!hiddenSet.has(p.to_unit)) {
        throw new Error(
          `Topology: parameter '${p.id}' (input_to_hidden_weight) to_unit '${p.to_unit}' is not in unit_order.hidden. ` +
            `Hint: input_to_hidden_weight to_unit MUST be a declared hidden unit.`,
        )
      }
    } else if (p.role === "hidden_to_output_weight") {
      if (p.from_unit === undefined || p.to_unit === undefined) {
        throw new Error(
          `Topology: parameter '${p.id}' has role 'hidden_to_output_weight' but is missing from_unit or to_unit. ` +
            `Hint: weights MUST declare both from_unit and to_unit.`,
        )
      }
      if (!hiddenSet.has(p.from_unit)) {
        throw new Error(
          `Topology: parameter '${p.id}' (hidden_to_output_weight) from_unit '${p.from_unit}' is not in unit_order.hidden. ` +
            `Hint: hidden_to_output_weight from_unit MUST be a declared hidden unit.`,
        )
      }
      if (!outputSet.has(p.to_unit)) {
        throw new Error(
          `Topology: parameter '${p.id}' (hidden_to_output_weight) to_unit '${p.to_unit}' is not in unit_order.output. ` +
            `Hint: hidden_to_output_weight to_unit MUST be a declared output unit.`,
        )
      }
    } else if (p.role === "hidden_bias") {
      hiddenBiasSeen += 1
      if (p.applies_to_units === undefined) {
        throw new Error(
          `Topology: parameter '${p.id}' has role 'hidden_bias' but is missing applies_to_units. ` +
            `Hint: per_layer biases MUST declare applies_to_units listing every hidden unit.`,
        )
      }
      assertAppliesToLayer(p.id, "hidden_bias", p.applies_to_units, t.unit_order.hidden, "hidden")
    } else if (p.role === "output_bias") {
      outputBiasSeen += 1
      if (p.applies_to_units === undefined) {
        throw new Error(
          `Topology: parameter '${p.id}' has role 'output_bias' but is missing applies_to_units. ` +
            `Hint: per_layer biases MUST declare applies_to_units listing every output unit.`,
        )
      }
      assertAppliesToLayer(p.id, "output_bias", p.applies_to_units, t.unit_order.output, "output")
    } else {
      // Exhaustiveness — TS should already prevent this at compile time
      throw new Error(
        `Topology: parameter '${(p as Parameter).id}' has unknown role '${String((p as Parameter).role)}'.`,
      )
    }
  }

  // per_layer bias sharing: exactly one hidden_bias and exactly one output_bias
  if (t.bias_sharing === "per_layer") {
    if (hiddenBiasSeen !== 1) {
      throw new Error(
        `Topology: bias_sharing is 'per_layer' but found ${hiddenBiasSeen} hidden_bias parameters (expected exactly 1). ` +
          `Hint: per_layer means one shared bias parameter per hidden layer.`,
      )
    }
    if (outputBiasSeen !== 1) {
      throw new Error(
        `Topology: bias_sharing is 'per_layer' but found ${outputBiasSeen} output_bias parameters (expected exactly 1). ` +
          `Hint: per_layer means one shared bias parameter per output layer.`,
      )
    }
  }

  // 7. Activations
  const supportedActivations: readonly string[] = ["sigmoid", "identity", "relu"]
  if (!supportedActivations.includes(t.activation_hidden)) {
    throw new Error(
      `Topology: activation_hidden '${t.activation_hidden}' is not supported. ` +
        `Hint: v0.3 supports {sigmoid, identity, relu}.`,
    )
  }
  if (!supportedActivations.includes(t.activation_output)) {
    throw new Error(
      `Topology: activation_output '${t.activation_output}' is not supported. ` +
        `Hint: v0.3 supports {sigmoid, identity, relu}.`,
    )
  }
}

function assertAppliesToLayer(
  paramId: string,
  role: string,
  appliesTo: readonly UnitId[],
  layerUnits: readonly UnitId[],
  layerName: string,
): void {
  if (appliesTo.length !== layerUnits.length) {
    throw new Error(
      `Topology: parameter '${paramId}' (${role}) applies_to_units has ${appliesTo.length} entries ` +
        `but the ${layerName} layer has ${layerUnits.length} units. ` +
        `Hint: per_layer means applies_to_units MUST list every unit in the ${layerName} layer exactly once.`,
    )
  }
  const layerSet = new Set(layerUnits)
  const seen = new Set<string>()
  for (const u of appliesTo) {
    if (!layerSet.has(u)) {
      throw new Error(
        `Topology: parameter '${paramId}' (${role}) applies_to_units references '${u}' ` +
          `which is not a declared ${layerName} unit. ` +
          `Hint: every entry in applies_to_units MUST appear in unit_order.${layerName}.`,
      )
    }
    if (seen.has(u)) {
      throw new Error(
        `Topology: parameter '${paramId}' (${role}) applies_to_units contains duplicate unit '${u}'. ` +
          `Hint: per_layer applies_to_units lists every layer unit exactly once.`,
      )
    }
    seen.add(u)
  }
}

/**
 * Linear scan for the weight parameter connecting `from_unit` -> `to_unit`.
 * Throws if no weight matches. Caller-side responsibility: pass a topology
 * that's been validated by `assertTopologyValid` first.
 *
 * Used by the engine to resolve weight ids during forward and update
 * phases. Performance is O(P) per lookup — acceptable for the small
 * topologies v0.3 targets (Mazur 10 params, XOR 8 params, iris 23 params);
 * if a future topology grows past ~1000 parameters consider building a
 * (from, to) -> Parameter map at topology-construction time instead.
 */
export function findWeight(
  parameters: readonly Parameter[],
  fromUnit: UnitId,
  toUnit: UnitId,
): Parameter {
  for (const p of parameters) {
    if (
      (p.role === "input_to_hidden_weight" || p.role === "hidden_to_output_weight") &&
      p.from_unit === fromUnit &&
      p.to_unit === toUnit
    ) {
      return p
    }
  }
  throw new Error(
    `Topology: no weight parameter found connecting from_unit='${fromUnit}' to to_unit='${toUnit}'. ` +
      `Hint: check parameters[] includes an input_to_hidden_weight or hidden_to_output_weight ` +
      `with the matching from_unit + to_unit fields.`,
  )
}

/**
 * Linear scan for the single per_layer hidden_bias parameter. Throws if
 * absent (the engine requires it) or if multiple exist (caller bypassed
 * assertTopologyValid).
 */
export function findHiddenBias(parameters: readonly Parameter[]): Parameter {
  let found: Parameter | undefined
  for (const p of parameters) {
    if (p.role === "hidden_bias") {
      if (found !== undefined) {
        throw new Error(
          `Topology: multiple hidden_bias parameters found ('${found.id}' and '${p.id}'). ` +
            `Hint: per_layer bias_sharing means exactly one hidden_bias parameter. ` +
            `Call assertTopologyValid(t) before calling findHiddenBias to catch this earlier.`,
        )
      }
      found = p
    }
  }
  if (found === undefined) {
    throw new Error(
      `Topology: no hidden_bias parameter found. ` +
        `Hint: per_layer bias_sharing requires exactly one hidden_bias parameter.`,
    )
  }
  return found
}

/**
 * Linear scan for the single per_layer output_bias parameter. Mirrors
 * findHiddenBias.
 */
export function findOutputBias(parameters: readonly Parameter[]): Parameter {
  let found: Parameter | undefined
  for (const p of parameters) {
    if (p.role === "output_bias") {
      if (found !== undefined) {
        throw new Error(
          `Topology: multiple output_bias parameters found ('${found.id}' and '${p.id}'). ` +
            `Hint: per_layer bias_sharing means exactly one output_bias parameter. ` +
            `Call assertTopologyValid(t) before calling findOutputBias to catch this earlier.`,
        )
      }
      found = p
    }
  }
  if (found === undefined) {
    throw new Error(
      `Topology: no output_bias parameter found. ` +
        `Hint: per_layer bias_sharing requires exactly one output_bias parameter.`,
    )
  }
  return found
}
