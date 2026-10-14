#if LEGACY_API
[assembly: ShiroBot.SDK.Core.ShiroBotApiCompatibility("invalid-ignored", "invalid-ignored")]
#endif
public static class Plugin
{
    public static System.Type Contract => typeof(ShiroBot.SDK.Core.ShiroBotApiCompatibilityAttribute);
    [System.Runtime.CompilerServices.ModuleInitializer]
    public static void Initialize() => throw new System.Exception("Plugin code must never execute during inspection");
}
