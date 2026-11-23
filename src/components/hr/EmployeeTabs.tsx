import Link from "next/link";

/** Employee Directory / Organization Tree switch at the top of both screens. */
export default function EmployeeTabs({ active }: { active: "directory" | "tree" }) {
  return (
    <div className="tabBar" role="tablist" aria-label="Employee view">
      <Link href="/hr/employees" role="tab" className="tabBarItem" aria-selected={active === "directory"}>
        Employee Directory
      </Link>
      <Link href="/hr/employees/tree" role="tab" className="tabBarItem" aria-selected={active === "tree"}>
        Organization Tree
      </Link>
    </div>
  );
}
