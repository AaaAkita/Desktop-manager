namespace DesktopManager.Models
{
    public class DesktopItem
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public string Path { get; set; }
        public bool IsDirectory { get; set; }
        public string Extension { get; set; }
        public string IconPath { get; set; }
        public string ThumbnailPath { get; set; }
        public string IconBase64 { get; set; }
        public string Source { get; set; }
        public bool Dock { get; set; }
        public DateTime LastModified { get; set; }
    }

    public class WebSocketMessage
    {
        public string RequestId { get; set; }
        public string Action { get; set; }
        public object Data { get; set; }
    }

    public class WebSocketResponse
    {
        public string RequestId { get; set; }
        public bool Success { get; set; }
        public object Data { get; set; }
        public string Error { get; set; }
    }

    public class DesktopInfo
    {
        public bool Success { get; set; }
        public List<DesktopItem> SystemDesktop { get; set; }
        public List<DesktopItem> UserDesktop { get; set; }
        public List<DesktopItem> PastedFiles { get; set; }
        public List<DesktopItem> Dock { get; set; }
    }
}
