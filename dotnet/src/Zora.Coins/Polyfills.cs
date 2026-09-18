#if NETSTANDARD2_1
namespace System.Runtime.CompilerServices
{
    // Lets records compile for .NET Standard 2.1 (Unity); the runtime needs nothing else.
    internal static class IsExternalInit { }
}
#endif
