using System.IO.Compression;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;

// Read PE metadata only. Never load an assembly or extract archive paths to disk.
const long maxBytes = 100 * 1024 * 1024;
var assemblies = new List<object>();
var abi = new SortedDictionary<string, string>(StringComparer.Ordinal);
var frameworks = new SortedSet<string>(StringComparer.Ordinal);

void Inspect(Stream stream, string path)
{
    using var pe = new PEReader(stream);
    if (!pe.HasMetadata) return;
    var reader = pe.GetMetadataReader();
    if (!reader.IsAssembly) return;
    var references = reader.AssemblyReferences.Select(reader.GetAssemblyReference)
        .Where(r => reader.GetString(r.Name) == "ShiroBot.SDK" || reader.GetString(r.Name).StartsWith("ShiroBot.Model.", StringComparison.Ordinal))
        .ToArray();
    if (references.Length == 0) return;
    foreach (var reference in references)
    {
        var name = reader.GetString(reference.Name);
        if (abi.TryGetValue(name, out var previous) && Version.Parse(previous).Major != reference.Version.Major)
            throw new InvalidDataException($"Conflicting ABI major versions for {name}");
        if (!abi.TryGetValue(name, out previous) || Version.Parse(previous) < reference.Version)
            abi[name] = reference.Version.ToString();
    }
    string? framework = null;
    foreach (var handle in reader.GetAssemblyDefinition().GetCustomAttributes())
    {
        var attribute = reader.GetCustomAttribute(handle);
        if (attribute.Constructor.Kind != HandleKind.MemberReference) continue;
        var parent = reader.GetMemberReference((MemberReferenceHandle)attribute.Constructor).Parent;
        if (parent.Kind != HandleKind.TypeReference) continue;
        var type = reader.GetTypeReference((TypeReferenceHandle)parent);
        var name = reader.GetString(type.Namespace) + "." + reader.GetString(type.Name);
        if (name != "System.Runtime.Versioning.TargetFrameworkAttribute") continue;
        var blob = reader.GetBlobReader(attribute.Value);
        if (blob.ReadUInt16() != 1) throw new InvalidDataException("Invalid attribute prolog");
        framework = blob.ReadSerializedString();
        if (framework is not null) frameworks.Add(framework);
    }
    assemblies.Add(new { path, name = reader.GetString(reader.GetAssemblyDefinition().Name), framework });
}

try
{
    var path = args.Single();
    if (new FileInfo(path).Length > maxBytes) throw new InvalidDataException("Asset too large");
    if (Path.GetExtension(path).Equals(".zip", StringComparison.OrdinalIgnoreCase))
    {
        using var zip = ZipFile.OpenRead(path);
        if (zip.Entries.Count > 1000) throw new InvalidDataException("Too many ZIP entries");
        long total = 0;
        foreach (var entry in zip.Entries)
        {
            total = checked(total + entry.Length);
            if (total > maxBytes) throw new InvalidDataException("ZIP expanded size exceeds limit");
        }
        foreach (var entry in zip.Entries.Where(e => e.FullName.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)))
        {
            using var input = entry.Open();
            using var data = new MemoryStream();
            var buffer = new byte[81920];
            int count;
            while ((count = input.Read(buffer)) != 0)
            {
                if (data.Length + count > entry.Length || data.Length + count > maxBytes) throw new InvalidDataException("Invalid ZIP size");
                data.Write(buffer, 0, count);
            }
            data.Position = 0;
            try { Inspect(data, entry.FullName); }
            catch (BadImageFormatException) { /* Native DLLs have no managed contract. */ }
        }
    }
    else
    {
        using var input = File.OpenRead(path);
        Inspect(input, Path.GetFileName(path));
    }
    var known = assemblies.Count > 0 && abi.ContainsKey("ShiroBot.SDK") && frameworks.Count > 0;
    Console.WriteLine(JsonSerializer.Serialize(new {
        status = known ? "verified" : "unknown",
        message = known ? "Requirements read from release assembly metadata; not a runtime compatibility test." : "Missing SDK ABI or target framework metadata.",
        abi, frameworks, assemblies
    }));
}
catch (Exception error)
{
    Console.Error.WriteLine(error.Message);
    Environment.ExitCode = 1;
}
