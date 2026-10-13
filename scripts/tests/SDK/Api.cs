namespace ShiroBot.SDK.Core;
[System.AttributeUsage(System.AttributeTargets.Assembly)]
public sealed class ShiroBotApiCompatibilityAttribute(string minimumVersion, string maximumVersion) : System.Attribute
{
    public string MinimumVersion { get; } = minimumVersion;
    public string MaximumVersion { get; } = maximumVersion;
}
