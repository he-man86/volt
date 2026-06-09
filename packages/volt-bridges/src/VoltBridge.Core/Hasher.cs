using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;

namespace VoltBridge.Core;

public static class Hasher
{
    public static string ComputeSha1Short(string input)
    {
        if (input == null) input = "";
        using var sha1 = SHA1.Create();
        var hash = sha1.ComputeHash(Encoding.UTF8.GetBytes(input));
        var hex = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
        return hex.Substring(0, 16);
    }

    public static string ComputeProjectVersion(Dictionary<string, string> versions)
    {
        using var sha1 = SHA1.Create();
        foreach (var name in new SortedSet<string>(versions.Keys))
        {
            var entry = name + "=" + (versions[name] ?? "") + "\0";
            var bytes = Encoding.UTF8.GetBytes(entry);
            sha1.TransformBlock(bytes, 0, bytes.Length, null, 0);
        }
        sha1.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        var hex = BitConverter.ToString(sha1.Hash).Replace("-", "").ToLowerInvariant();
        return hex.Substring(0, 16);
    }

    public static string ComputeStructureVersion(Dictionary<string, string> versions)
    {
        using var sha1 = SHA1.Create();
        foreach (var name in new SortedSet<string>(versions.Keys))
        {
            var bytes = Encoding.UTF8.GetBytes(name + "\0");
            sha1.TransformBlock(bytes, 0, bytes.Length, null, 0);
        }
        sha1.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        var hex = BitConverter.ToString(sha1.Hash).Replace("-", "").ToLowerInvariant();
        return hex.Substring(0, 16);
    }
}
