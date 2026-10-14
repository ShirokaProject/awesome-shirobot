// Requirements come from release assembly references, never from source declarations.
export function marketCompatibility(contract) {
  const frameworks = contract?.frameworks ?? [];
  return {
    // Keep the v1 string fields readable without inventing a host product range.
    shirobot: "unknown",
    framework: frameworks.length === 1 ? frameworks[0].replace(/^\.NETCoreApp,Version=v/, "net") : "unknown",
    status: contract?.status ?? "unknown",
    message: contract?.message ?? "No release asset to inspect.",
    abi: contract?.abi ?? {},
    frameworks,
    assemblies: (contract?.assemblies ?? []).map(({ minimumApi, testedApi, ...assembly }) => assembly),
  };
}
