// Keep the v1 catalog declaration readable by existing clients. Inspection
// describes assembly contracts; it cannot infer a host product version range.
export function marketCompatibility(declared, contract) {
  return {
    ...(contract ?? { status: "unknown", message: "No release asset to inspect.", api: null, abi: {}, frameworks: [], assemblies: [] }),
    ...declared,
  };
}
