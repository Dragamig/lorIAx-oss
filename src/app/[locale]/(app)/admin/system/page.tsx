import { AdminSystemTab } from "./system-tab";
import { BackToServices } from "@/components/admin/back-to-services";
export default function SystemPage() {
  return (
    <div className="pb-24">
      <BackToServices />
      <AdminSystemTab />
    </div>
  );
}
