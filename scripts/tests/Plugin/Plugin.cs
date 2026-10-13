[assembly: ShiroBot.SDK.Core.ShiroBotApiCompatibility("1.0", "1.0")]
public static class Plugin
{
    [System.Runtime.CompilerServices.ModuleInitializer]
    public static void Initialize() => throw new System.Exception("Plugin code must never execute during inspection");
}
