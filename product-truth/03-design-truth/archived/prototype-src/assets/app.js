document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-nav]").forEach((group) => {
        group.querySelectorAll(".nav-item, .config-link, .queue-item").forEach((item) => {
            item.addEventListener("click", () => {
                group.querySelectorAll(".active").forEach((active) => active.classList.remove("active"));
                item.classList.add("active");
            });
        });
    });

    document.querySelectorAll("[data-toggle]").forEach((toggle) => {
        toggle.addEventListener("click", () => {
            toggle.classList.toggle("on");
        });
    });
});
