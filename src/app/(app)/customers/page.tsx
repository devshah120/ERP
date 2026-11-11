import { getResourceUi } from "@/lib/resources/ui/registry";
import ResourceListView from "@/components/resource/ResourceListView";

/**
 * The customer listing now runs on the same generic list component as every
 * other master, so column selection, filters, export, import, row actions,
 * bulk selection and keyboard shortcuts behave identically here.
 *
 * Creating and editing still use the bespoke CustomerForm under
 * /customers/new and /customers/[id].
 */
export default function CustomersListPage() {
  const config = getResourceUi("customers")!;
  return <ResourceListView config={config} />;
}
