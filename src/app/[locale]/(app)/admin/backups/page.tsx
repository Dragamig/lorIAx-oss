import { AdminBackupsTab } from "./backups-tab";
import { BackToServices } from "@/components/admin/back-to-services";
export default function BackupsPage() {
  return (
    <div className="pb-24">
      <BackToServices />
      <AdminBackupsTab />
    </div>
  );
}
