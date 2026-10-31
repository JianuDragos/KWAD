using System;
using System.Diagnostics;
using System.Reflection;
using Xunit;

namespace AERIS.Tests;

public class Program
{
    public static int Main(string[] args)
    {
        Console.WriteLine("================================================================================");
        Console.WriteLine(" AERIS — Trajectory & Separation Engine Test Suite (.NET 10)");
        Console.WriteLine("================================================================================");

        var testClass = new TrajectorySeparationTests();
        var methods = typeof(TrajectorySeparationTests)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .Where(m => m.GetCustomAttribute<FactAttribute>() != null)
            .OrderBy(m => m.Name)
            .ToList();

        int passed = 0;
        int failed = 0;
        var stopwatch = Stopwatch.StartNew();

        foreach (var method in methods)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                method.Invoke(testClass, null);
                sw.Stop();
                Console.ForegroundColor = ConsoleColor.Green;
                Console.Write(" [PASS] ");
                Console.ResetColor();
                Console.WriteLine($"{method.Name} ({sw.ElapsedMilliseconds} ms)");
                passed++;
            }
            catch (TargetInvocationException ex)
            {
                sw.Stop();
                Console.ForegroundColor = ConsoleColor.Red;
                Console.Write(" [FAIL] ");
                Console.ResetColor();
                Console.WriteLine($"{method.Name} ({sw.ElapsedMilliseconds} ms)");
                Console.WriteLine($"        Error: {ex.InnerException?.Message ?? ex.Message}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"        Details: {ex.InnerException}");
                }
                failed++;
            }
            catch (Exception ex)
            {
                sw.Stop();
                Console.ForegroundColor = ConsoleColor.Red;
                Console.Write(" [FAIL] ");
                Console.ResetColor();
                Console.WriteLine($"{method.Name} ({sw.ElapsedMilliseconds} ms)");
                Console.WriteLine($"        Error: {ex.Message}");
                failed++;
            }
        }

        stopwatch.Stop();
        Console.WriteLine("================================================================================");
        if (failed == 0)
        {
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine($" ALL {passed} TESTS PASSED SUCCESSFULLY! (Total: {stopwatch.ElapsedMilliseconds} ms)");
        }
        else
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine($" {failed} TEST(S) FAILED out of {passed + failed} total. (Total: {stopwatch.ElapsedMilliseconds} ms)");
        }
        Console.ResetColor();
        Console.WriteLine("================================================================================");

        return failed == 0 ? 0 : 1;
    }
}
