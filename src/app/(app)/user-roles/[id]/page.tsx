import RoleEditor from "@/components/admin/RoleEditor";

export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RoleEditor roleId={id} />;
}
